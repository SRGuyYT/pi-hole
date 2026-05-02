const APP_NAME = "pro-url-grubx";
const DEFAULT_ALLOWED_ORIGIN = "*";

const ROUTE_PREFIXES = ["/api"];

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

function corsHeaders(env) {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-requested-with",
    "access-control-max-age": "86400",
  };
}

function json(data, status = 200, env = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(env),
      "cache-control": "no-store",
    },
  });
}

function redirect(url, status = 302) {
  return Response.redirect(url.toString(), status);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function readFormOrJson(request) {
  const type = request.headers.get("content-type") || "";

  if (type.includes("application/json")) {
    return await readJson(request);
  }

  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }

  return {};
}

function requireEnv(env, key) {
  if (!env[key]) {
    throw new Error(`Missing Cloudflare secret: ${key}`);
  }

  return env[key];
}

function cleanPath(url) {
  let path = url.pathname;

  for (const prefix of ROUTE_PREFIXES) {
    if (path === prefix) return "/";
    if (path.startsWith(prefix + "/")) {
      path = path.slice(prefix.length);
    }
  }

  return path || "/";
}

function getBearer(request) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth;
}

async function fetchJson(url, options = {}, env = {}) {
  const res = await fetch(url, options);
  const text = await res.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return json(data, res.status, env);
}

function buildUrl(base, params = {}) {
  const u = new URL(base);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      u.searchParams.set(key, String(value));
    }
  }

  return u;
}

/* -------------------------------------------------------
   YOUTUBE
------------------------------------------------------- */

async function handleYoutube(request, env, url, path) {
  const apiKey = requireEnv(env, "YOUTUBE_API_KEY");
  const subPath = path.replace(/^\/youtube/, "") || "/";

  if (subPath === "/" || subPath === "/health") {
    return json({
      ok: true,
      service: "youtube",
      routes: {
        search: "/api/youtube/search?q=minecraft",
        videos: "/api/youtube/videos?id=VIDEO_ID",
        channels: "/api/youtube/channels?id=CHANNEL_ID",
        playlists: "/api/youtube/playlists?channelId=CHANNEL_ID",
        playlistItems: "/api/youtube/playlistItems?playlistId=PLAYLIST_ID",
      },
    }, 200, env);
  }

  if (subPath === "/search") {
    const q = url.searchParams.get("q") || "";
    const maxResults = url.searchParams.get("maxResults") || "12";
    const type = url.searchParams.get("type") || "video";

    if (!q) return json({ error: "Missing q" }, 400, env);

    const apiUrl = buildUrl("https://www.googleapis.com/youtube/v3/search", {
      part: "snippet",
      type,
      q,
      maxResults,
      safeSearch: url.searchParams.get("safeSearch") || "moderate",
      order: url.searchParams.get("order") || "relevance",
      pageToken: url.searchParams.get("pageToken"),
      key: apiKey,
    });

    return fetchJson(apiUrl, {}, env);
  }

  if (subPath === "/videos") {
    const id = url.searchParams.get("id");

    if (!id) return json({ error: "Missing id" }, 400, env);

    const apiUrl = buildUrl("https://www.googleapis.com/youtube/v3/videos", {
      part: url.searchParams.get("part") || "snippet,contentDetails,statistics,player",
      id,
      key: apiKey,
    });

    return fetchJson(apiUrl, {}, env);
  }

  if (subPath === "/channels") {
    const id = url.searchParams.get("id");
    const forUsername = url.searchParams.get("forUsername");

    if (!id && !forUsername) {
      return json({ error: "Missing id or forUsername" }, 400, env);
    }

    const apiUrl = buildUrl("https://www.googleapis.com/youtube/v3/channels", {
      part: url.searchParams.get("part") || "snippet,statistics,contentDetails",
      id,
      forUsername,
      key: apiKey,
    });

    return fetchJson(apiUrl, {}, env);
  }

  if (subPath === "/playlists") {
    const channelId = url.searchParams.get("channelId");

    if (!channelId) return json({ error: "Missing channelId" }, 400, env);

    const apiUrl = buildUrl("https://www.googleapis.com/youtube/v3/playlists", {
      part: "snippet,contentDetails",
      channelId,
      maxResults: url.searchParams.get("maxResults") || "12",
      pageToken: url.searchParams.get("pageToken"),
      key: apiKey,
    });

    return fetchJson(apiUrl, {}, env);
  }

  if (subPath === "/playlistItems") {
    const playlistId = url.searchParams.get("playlistId");

    if (!playlistId) return json({ error: "Missing playlistId" }, 400, env);

    const apiUrl = buildUrl("https://www.googleapis.com/youtube/v3/playlistItems", {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: url.searchParams.get("maxResults") || "12",
      pageToken: url.searchParams.get("pageToken"),
      key: apiKey,
    });

    return fetchJson(apiUrl, {}, env);
  }

  return json({ error: "YouTube route not found", path: subPath }, 404, env);
}

/* -------------------------------------------------------
   SPOTIFY
------------------------------------------------------- */

async function getSpotifyAppToken(env) {
  const clientId = requireEnv(env, "SPOTIFY_CLIENT_ID");
  const clientSecret = requireEnv(env, "SPOTIFY_CLIENT_SECRET");

  const basic = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Spotify app token failed: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

async function handleSpotify(request, env, url, path) {
  const subPath = path.replace(/^\/spotify/, "") || "/";

  if (subPath === "/" || subPath === "/health") {
    return json({
      ok: true,
      service: "spotify",
      routes: {
        authorize: "/api/spotify/accounts/authorize",
        token: "/api/spotify/accounts/token",
        refresh: "/api/spotify/accounts/refresh",
        search: "/api/spotify/search?q=juice%20wrld",
        me: "/api/spotify/me",
        player: "/api/spotify/me/player",
      },
    }, 200, env);
  }

  if (subPath === "/accounts/authorize") {
    const clientId = requireEnv(env, "SPOTIFY_CLIENT_ID");

    const spotifyUrl = buildUrl("https://accounts.spotify.com/authorize", {
      response_type: url.searchParams.get("response_type") || "code",
      client_id: url.searchParams.get("client_id") || clientId,
      scope: url.searchParams.get("scope") || "streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-modify-private playlist-modify-public",
      redirect_uri: url.searchParams.get("redirect_uri") || env.SPOTIFY_REDIRECT_URI,
      state: url.searchParams.get("state"),
      show_dialog: url.searchParams.get("show_dialog") || "true",
    });

    return redirect(spotifyUrl);
  }

  if (subPath === "/accounts/token") {
    const body = await readFormOrJson(request);

    const code = body.code || url.searchParams.get("code");
    const redirectUri = body.redirect_uri || url.searchParams.get("redirect_uri") || env.SPOTIFY_REDIRECT_URI;

    if (!code) return json({ error: "Missing code" }, 400, env);
    if (!redirectUri) return json({ error: "Missing redirect_uri" }, 400, env);

    const clientId = requireEnv(env, "SPOTIFY_CLIENT_ID");
    const clientSecret = requireEnv(env, "SPOTIFY_CLIENT_SECRET");
    const basic = btoa(`${clientId}:${clientSecret}`);

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await res.json();
    return json(data, res.status, env);
  }

  if (subPath === "/accounts/refresh") {
    const body = await readFormOrJson(request);
    const refreshToken = body.refresh_token || url.searchParams.get("refresh_token");

    if (!refreshToken) return json({ error: "Missing refresh_token" }, 400, env);

    const clientId = requireEnv(env, "SPOTIFY_CLIENT_ID");
    const clientSecret = requireEnv(env, "SPOTIFY_CLIENT_SECRET");
    const basic = btoa(`${clientId}:${clientSecret}`);

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const data = await res.json();
    return json(data, res.status, env);
  }

  if (subPath === "/search") {
    const q = url.searchParams.get("q") || "";
    const type = url.searchParams.get("type") || "track,artist,album,playlist";
    const limit = url.searchParams.get("limit") || "12";

    if (!q) return json({ error: "Missing q" }, 400, env);

    const token = await getSpotifyAppToken(env);

    const apiUrl = buildUrl("https://api.spotify.com/v1/search", {
      q,
      type,
      limit,
      market: url.searchParams.get("market") || "US",
      offset: url.searchParams.get("offset"),
    });

    return fetchJson(apiUrl, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    }, env);
  }

  if (subPath === "/me") {
    const auth = getBearer(request);
    if (!auth) return json({ error: "Missing Authorization: Bearer ACCESS_TOKEN" }, 401, env);

    return fetchJson("https://api.spotify.com/v1/me", {
      headers: { authorization: auth },
    }, env);
  }

  if (subPath.startsWith("/me/player")) {
    const auth = getBearer(request);
    if (!auth) return json({ error: "Missing Authorization: Bearer ACCESS_TOKEN" }, 401, env);

    const target = "https://api.spotify.com/v1" + subPath;

    const init = {
      method: request.method,
      headers: {
        authorization: auth,
        "content-type": request.headers.get("content-type") || "application/json",
      },
    };

    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = await request.text();
    }

    const res = await fetch(target, init);
    const text = await res.text();

    return new Response(text || "{}", {
      status: res.status,
      headers: {
        ...JSON_HEADERS,
        ...corsHeaders(env),
      },
    });
  }

  return json({ error: "Spotify route not found", path: subPath }, 404, env);
}

/* -------------------------------------------------------
   TIKTOK
------------------------------------------------------- */

async function handleTikTok(request, env, url, path) {
  const subPath = path.replace(/^\/tiktok/, "") || "/";

  if (subPath === "/" || subPath === "/health") {
    return json({
      ok: true,
      service: "tiktok",
      routes: {
        authorize: "/api/tiktok/oauth/authorize",
        token: "/api/tiktok/oauth/token",
        refresh: "/api/tiktok/oauth/refresh",
        user: "/api/tiktok/user",
        callback: "/api/tiktok/callback",
      },
    }, 200, env);
  }

  if (subPath === "/oauth/authorize") {
    const clientKey = requireEnv(env, "TIKTOK_CLIENT_KEY");

    const tiktokUrl = buildUrl("https://www.tiktok.com/v2/auth/authorize/", {
      client_key: url.searchParams.get("client_key") || clientKey,
      response_type: url.searchParams.get("response_type") || "code",
      scope: url.searchParams.get("scope") || "user.info.basic",
      redirect_uri: url.searchParams.get("redirect_uri") || env.TIKTOK_REDIRECT_URI,
      state: url.searchParams.get("state"),
    });

    return redirect(tiktokUrl);
  }

  if (subPath === "/oauth/token") {
    const body = await readFormOrJson(request);

    const code = body.code || url.searchParams.get("code");
    const redirectUri = body.redirect_uri || url.searchParams.get("redirect_uri") || env.TIKTOK_REDIRECT_URI;

    if (!code) return json({ error: "Missing code" }, 400, env);
    if (!redirectUri) return json({ error: "Missing redirect_uri" }, 400, env);

    const clientKey = requireEnv(env, "TIKTOK_CLIENT_KEY");
    const clientSecret = requireEnv(env, "TIKTOK_CLIENT_SECRET");

    const params = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    if (body.code_verifier) {
      params.set("code_verifier", body.code_verifier);
    }

    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const data = await res.json();
    return json(data, res.status, env);
  }

  if (subPath === "/oauth/refresh") {
    const body = await readFormOrJson(request);
    const refreshToken = body.refresh_token || url.searchParams.get("refresh_token");

    if (!refreshToken) return json({ error: "Missing refresh_token" }, 400, env);

    const clientKey = requireEnv(env, "TIKTOK_CLIENT_KEY");
    const clientSecret = requireEnv(env, "TIKTOK_CLIENT_SECRET");

    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const data = await res.json();
    return json(data, res.status, env);
  }

  if (subPath === "/user") {
    const auth = getBearer(request);

    if (!auth) {
      return json({ error: "Missing Authorization: Bearer ACCESS_TOKEN" }, 401, env);
    }

    const fields =
      url.searchParams.get("fields") ||
      "open_id,union_id,avatar_url,avatar_url_100,avatar_large_url,display_name,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count";

    const apiUrl = buildUrl("https://open.tiktokapis.com/v2/user/info/", {
      fields,
    });

    return fetchJson(apiUrl, {
      headers: {
        authorization: auth,
      },
    }, env);
  }

  if (subPath === "/search") {
    return json({
      error: "TikTok public search is not supported by this proxy.",
      message: "TikTok search needs approved TikTok API access. This Worker will not bypass TikTok restrictions.",
    }, 501, env);
  }

  if (subPath === "/callback") {
    return json({
      ok: true,
      service: "tiktok",
      message: "TikTok callback reached.",
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      error: url.searchParams.get("error"),
    }, 200, env);
  }

  return json({ error: "TikTok route not found", path: subPath }, 404, env);
}

/* -------------------------------------------------------
   MAIN WORKER
------------------------------------------------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = cleanPath(url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env),
      });
    }

    try {
      if (path === "/" || path === "/health") {
        return json({
          ok: true,
          name: APP_NAME,
          domain: url.hostname,
          supportsApiPrefix: true,
          routes: {
            health: "/health",
            youtube: "/api/youtube",
            spotify: "/api/spotify",
            tiktok: "/api/tiktok",
          },
        }, 200, env);
      }

      if (path.startsWith("/youtube")) {
        return await handleYoutube(request, env, url, path);
      }

      if (path.startsWith("/spotify")) {
        return await handleSpotify(request, env, url, path);
      }

      if (path.startsWith("/tiktok")) {
        return await handleTikTok(request, env, url, path);
      }

      return json({
        error: "Not found",
        path,
        hint: "Use /api/youtube, /api/spotify, or /api/tiktok",
      }, 404, env);
    } catch (err) {
      return json({
        error: "Worker error",
        message: String(err.message || err),
      }, 500, env);
    }
  },
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

function corsHeaders(env) {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };
}

function json(data, status = 200, env = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(env),
    },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function requireEnv(env, key) {
  if (!env[key]) {
    throw new Error(`Missing secret: ${key}`);
  }
  return env[key];
}

async function spotifyToken(env) {
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
    throw new Error(JSON.stringify(data));
  }

  return data.access_token;
}

async function handleYoutube(request, env, url) {
  const apiKey = requireEnv(env, "YOUTUBE_API_KEY");
  const path = url.pathname.replace(/^\/youtube/, "") || "/";

  if (path === "/search") {
    const q = url.searchParams.get("q") || "";
    const maxResults = url.searchParams.get("maxResults") || "12";

    if (!q) {
      return json({ error: "Missing q" }, 400, env);
    }

    const apiUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    apiUrl.searchParams.set("part", "snippet");
    apiUrl.searchParams.set("type", "video");
    apiUrl.searchParams.set("q", q);
    apiUrl.searchParams.set("maxResults", maxResults);
    apiUrl.searchParams.set("key", apiKey);

    const res = await fetch(apiUrl);
    const data = await res.json();

    return json(data, res.status, env);
  }

  if (path === "/videos") {
    const id = url.searchParams.get("id");

    if (!id) {
      return json({ error: "Missing id" }, 400, env);
    }

    const apiUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    apiUrl.searchParams.set("part", "snippet,contentDetails,statistics");
    apiUrl.searchParams.set("id", id);
    apiUrl.searchParams.set("key", apiKey);

    const res = await fetch(apiUrl);
    const data = await res.json();

    return json(data, res.status, env);
  }

  return json({
    service: "youtube",
    routes: [
      "/youtube/search?q=minecraft",
      "/youtube/videos?id=VIDEO_ID",
    ],
  }, 200, env);
}

async function handleSpotify(request, env, url) {
  const path = url.pathname.replace(/^\/spotify/, "") || "/";

  if (path === "/search") {
    const q = url.searchParams.get("q") || "";
    const type = url.searchParams.get("type") || "track,artist,album,playlist";
    const limit = url.searchParams.get("limit") || "12";

    if (!q) {
      return json({ error: "Missing q" }, 400, env);
    }

    const token = await spotifyToken(env);

    const apiUrl = new URL("https://api.spotify.com/v1/search");
    apiUrl.searchParams.set("q", q);
    apiUrl.searchParams.set("type", type);
    apiUrl.searchParams.set("limit", limit);

    const res = await fetch(apiUrl, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json();
    return json(data, res.status, env);
  }

  if (path === "/accounts/token") {
    const body = await readJson(request);

    if (!body.code || !body.redirect_uri) {
      return json({
        error: "Missing code or redirect_uri",
      }, 400, env);
    }

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
        code: body.code,
        redirect_uri: body.redirect_uri,
      }),
    });

    const data = await res.json();
    return json(data, res.status, env);
  }

  return json({
    service: "spotify",
    routes: [
      "/spotify/search?q=juice wrld",
      "/spotify/accounts/token",
    ],
  }, 200, env);
}

async function handleTikTok(request, env, url) {
  const path = url.pathname.replace(/^\/tiktok/, "") || "/";

  if (path === "/oauth/token") {
    const body = await readJson(request);

    if (!body.code || !body.redirect_uri) {
      return json({
        error: "Missing code or redirect_uri",
      }, 400, env);
    }

    const clientKey = requireEnv(env, "TIKTOK_CLIENT_KEY");
    const clientSecret = requireEnv(env, "TIKTOK_CLIENT_SECRET");

    const params = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: body.code,
      grant_type: "authorization_code",
      redirect_uri: body.redirect_uri,
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

  if (path === "/user") {
    const auth = request.headers.get("authorization");

    if (!auth) {
      return json({
        error: "Missing Authorization: Bearer ACCESS_TOKEN",
      }, 401, env);
    }

    const apiUrl = new URL("https://open.tiktokapis.com/v2/user/info/");
    apiUrl.searchParams.set(
      "fields",
      "open_id,union_id,avatar_url,avatar_url_100,avatar_large_url,display_name,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count"
    );

    const res = await fetch(apiUrl, {
      headers: {
        authorization: auth,
      },
    });

    const data = await res.json();
    return json(data, res.status, env);
  }

  if (path === "/search") {
    return json({
      error: "TikTok public search is not available here.",
      message: "TikTok search usually requires approved API access. This proxy will not bypass TikTok restrictions.",
    }, 501, env);
  }

  if (path === "/callback") {
    return json({
      message: "TikTok callback reached.",
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      error: url.searchParams.get("error"),
    }, 200, env);
  }

  return json({
    service: "tiktok",
    routes: [
      "/tiktok/oauth/token",
      "/tiktok/user",
      "/tiktok/callback",
    ],
  }, 200, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env),
      });
    }

    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        return json({
          ok: true,
          name: "GrubX API Proxy",
          youtube: "/youtube",
          spotify: "/spotify",
          tiktok: "/tiktok",
        }, 200, env);
      }

      if (url.pathname.startsWith("/youtube")) {
        return await handleYoutube(request, env, url);
      }

      if (url.pathname.startsWith("/spotify")) {
        return await handleSpotify(request, env, url);
      }

      if (url.pathname.startsWith("/tiktok")) {
        return await handleTikTok(request, env, url);
      }

      return json({
        error: "Not found",
      }, 404, env);
    } catch (err) {
      return json({
        error: String(err.message || err),
      }, 500, env);
    }
  },
};

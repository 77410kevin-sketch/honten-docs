/**
 * reports.kevinhung.org Worker
 *
 * 處理 API 請求；其他 fallback 到靜態檔（ASSETS）。
 *
 * API:
 *   GET  /api/meta              → 回傳目前 meta.json
 *   GET  /api/list-files        → 列出 repo 中所有 .html
 *   POST /api/save-meta         → 寫回 meta.json + 重新 build
 *   POST /api/delete-file       → 刪除指定 HTML 檔
 *
 * 認證：Cloudflare Access 已在路由層擋過一道（CF-Access-* headers），
 *      Worker 內進一步檢查 header 存在性。
 */

const GH_REPO = "77410kevin-sketch/honten-docs";
const GH_BRANCH = "master";
const COMMIT_AUTHOR = { name: "reports admin", email: "77410kevin@gmail.com" };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ---- API 路由 ----
    if (url.pathname.startsWith("/api/")) {
      // Access 認證（信任 Cloudflare Access 的 header）
      const accessEmail = request.headers.get("CF-Access-Authenticated-User-Email");
      if (!accessEmail) {
        return json({ error: "Unauthorized: no Access JWT" }, 401);
      }

      // 全 API 統一檢查 token
      if (!env.GITHUB_TOKEN) {
        return json({
          error: "GITHUB_TOKEN secret 未設定",
          hint: "請到 Cloudflare Dashboard → Workers & Pages → honten-docs → Settings → Variables and Secrets，加一個 Secret 名為 GITHUB_TOKEN（值用 .env 內的 GITHUB_PAT_HONTEN_DOCS）",
        }, 500);
      }

      try {
        if (url.pathname === "/api/meta" && request.method === "GET") {
          return await handleGetMeta(env);
        }
        if (url.pathname === "/api/list-files" && request.method === "GET") {
          return await handleListFiles(env);
        }
        if (url.pathname === "/api/save-meta" && request.method === "POST") {
          return await handleSaveMeta(request, env, accessEmail);
        }
        if (url.pathname === "/api/delete-file" && request.method === "POST") {
          return await handleDeleteFile(request, env, accessEmail);
        }
        if (url.pathname === "/api/move-file" && request.method === "POST") {
          return await handleMoveFile(request, env, accessEmail);
        }
        return json({ error: "Not found" }, 404);
      } catch (e) {
        return json({ error: String(e), stack: e.stack }, 500);
      }
    }

    // ---- 其他全部走靜態檔 ----
    return env.ASSETS.fetch(request);
  },
};

// ============ Handlers ============

async function handleGetMeta(env) {
  const resp = await githubFetch(
    env,
    `https://api.github.com/repos/${GH_REPO}/contents/meta.json?ref=${GH_BRANCH}`
  );
  if (!resp.ok) {
    const errText = await resp.text();
    return json({
      error: `GitHub API ${resp.status}`,
      hint: resp.status === 401
        ? "PAT 無效或過期"
        : resp.status === 404
        ? "可能 PAT 沒這個 repo 的讀取權限，或 meta.json 不在 master 分支"
        : "未知錯誤",
      details: errText.substring(0, 300),
    }, 500);
  }
  const data = await resp.json();
  const b64 = (data.content || "").replace(/\n/g, "");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const content = new TextDecoder("utf-8").decode(bytes);
  return json(JSON.parse(content));
}

async function handleListFiles(env) {
  const files = await listHtmlInDir(env, "");          // 根目錄＝鎖定區
  const pub = await listHtmlInDir(env, "share");        // share/＝公用區
  if (files === null) return json({ error: "GitHub list failed" }, 500);
  return json({ files, public: pub || [] });
}

/** 列出某資料夾下的 .html（去掉副檔名、排除 index.html）。失敗回 null，資料夾不存在回 []。 */
async function listHtmlInDir(env, dir) {
  const path = dir ? `${encodeURIComponent(dir)}` : "";
  const resp = await githubFetch(
    env,
    `https://api.github.com/repos/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`
  );
  if (resp.status === 404) return [];
  if (!resp.ok) return null;
  const items = await resp.json();
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i.type === "file" && i.name.endsWith(".html") && i.name !== "index.html")
    .map((i) => i.name.replace(/\.html$/i, ""))
    .sort();
}

async function handleSaveMeta(request, env, email) {
  const newMeta = await request.json();
  // 基本驗證
  if (!newMeta || !Array.isArray(newMeta.categories)) {
    return json({ error: "Invalid meta: missing categories array" }, 400);
  }

  const content = JSON.stringify(newMeta, null, 2) + "\n";
  const result = await githubPutFile(
    env,
    "meta.json",
    content,
    `Admin edit meta.json by ${email}`
  );
  if (!result.ok) {
    return json({ error: "GitHub PUT failed", details: result.error }, 500);
  }
  return json({
    success: true,
    message: "meta.json 已更新，30-60 秒內生效",
    commit: result.commit,
  });
}

async function handleDeleteFile(request, env, email) {
  const body = await request.json();
  const filename = body.filename; // e.g. "泰國視察行程規劃_20260519-23.html"
  if (!filename || !filename.endsWith(".html") || filename === "index.html") {
    return json({ error: "Invalid filename" }, 400);
  }
  const file = await githubGetFile(env, filename);
  if (!file) return json({ error: "File not found in repo" }, 404);

  const resp = await githubFetch(
    env,
    `https://api.github.com/repos/${GH_REPO}/contents/${encodeURIComponent(filename)}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        message: `Admin delete ${filename} by ${email}`,
        sha: file.sha,
        branch: GH_BRANCH,
        author: COMMIT_AUTHOR,
        committer: COMMIT_AUTHOR,
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    return json({ error: `GitHub DELETE ${resp.status}`, details: errText }, 500);
  }

  return json({ success: true, message: `已刪除 ${filename}` });
}

/** 把 HTML 在「鎖定區(根目錄)」與「公用區(share/)」之間搬移 —— 單一 commit（避免部署塞車） */
async function handleMoveFile(request, env, email) {
  const body = await request.json();
  const filename = body.filename;            // e.g. "thailand_factory_analysis.html"
  const to = body.to;                        // "public" | "private"
  if (!filename || !filename.endsWith(".html") || filename === "index.html" || filename.includes("/")) {
    return json({ error: "Invalid filename" }, 400);
  }
  if (to !== "public" && to !== "private") {
    return json({ error: "Invalid 'to'（需 public 或 private）" }, 400);
  }
  const base = filename.replace(/\.html$/i, "");
  const src = to === "public" ? filename : `share/${filename}`;
  const dest = to === "public" ? `share/${filename}` : filename;

  const file = await githubGetFile(env, src);
  if (!file) return json({ error: `來源檔不存在：${src}` }, 404);

  // 算出「搬移後」的公用區清單，據此重建 manifest（永遠與實際資料夾一致）
  let shareFiles = (await listHtmlInDir(env, "share")) || [];
  if (to === "public") {
    if (!shareFiles.includes(base)) shareFiles.push(base);
  } else {
    shareFiles = shareFiles.filter((f) => f !== base);
  }
  const manifest = await buildManifest(env, shareFiles);

  // 一個 commit 同時：建目的地、刪來源、更新 manifest → 只觸發一次 Cloudflare 部署
  const res = await githubCommitChanges(
    env, GH_BRANCH,
    [
      { path: dest, content: file.content },
      { path: src, delete: true },
      { path: "share/manifest.json", content: JSON.stringify(manifest, null, 2) + "\n" },
    ],
    `Move ${filename} → ${to} by ${email}`
  );
  if (!res.ok) return json({ error: "搬移失敗", details: res.error }, 500);

  return json({
    success: true,
    message: `${filename} 已${to === "public" ? "設為公開" : "移回鎖定"}，30-60 秒生效`,
  });
}

/** 依公用區檔名清單建出 manifest（顯示資訊優先取自 meta.json） */
async function buildManifest(env, shareBaseNames) {
  let lookup = {};
  try {
    const meta = await getMetaObject(env);
    for (const c of meta.categories || []) {
      for (const it of c.items || []) lookup[it.file] = it;
    }
    // 「其他文件」上傳檔的自訂顯示（misc_overrides）也納入
    const ov = meta.misc_overrides || {};
    for (const f in ov) if (!lookup[f]) lookup[f] = ov[f];
  } catch {}
  return shareBaseNames
    .slice()
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map((f) => {
      const it = lookup[f] || {};
      return { file: f, name: it.name || f, desc: it.desc || "", icon: it.icon || "📄" };
    });
}

async function getMetaObject(env) {
  const file = await githubGetFile(env, "meta.json");
  if (!file) return { categories: [] };
  return JSON.parse(file.content);
}

// ============ GitHub helpers ============

/** 對路徑每段做 URL 編碼但保留斜線（支援 share/ 子資料夾與中文檔名） */
function encodePath(p) {
  return String(p).split("/").map(encodeURIComponent).join("/");
}

/** 刪除 GitHub 檔案；不存在視為成功 */
async function githubDeleteFile(env, path, message) {
  const file = await githubGetFile(env, path);
  if (!file) return { ok: true };
  const resp = await githubFetch(
    env,
    `https://api.github.com/repos/${GH_REPO}/contents/${encodePath(path)}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        message, sha: file.sha, branch: GH_BRANCH,
        author: COMMIT_AUTHOR, committer: COMMIT_AUTHOR,
      }),
    }
  );
  if (!resp.ok) return { ok: false, error: `${resp.status}: ${await resp.text()}` };
  return { ok: true };
}

/** 用 Git Data API 把多個檔案變更（content 或 delete）合成「單一 commit」 */
async function githubCommitChanges(env, branch, changes, message) {
  const api = `https://api.github.com/repos/${GH_REPO}`;
  // 1. 取分支 head sha
  let r = await githubFetch(env, `${api}/git/ref/heads/${branch}`);
  if (!r.ok) return { ok: false, error: `ref ${r.status}: ${await r.text()}` };
  const headSha = (await r.json()).object.sha;
  // 2. head commit → base tree
  r = await githubFetch(env, `${api}/git/commits/${headSha}`);
  if (!r.ok) return { ok: false, error: `commit ${r.status}` };
  const baseTree = (await r.json()).tree.sha;
  // 3. 建 tree（content=新增/覆蓋；delete→sha:null 表刪除）
  const tree = changes.map((c) =>
    c.delete
      ? { path: c.path, mode: "100644", type: "blob", sha: null }
      : { path: c.path, mode: "100644", type: "blob", content: c.content }
  );
  r = await githubFetch(env, `${api}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree }),
  });
  if (!r.ok) return { ok: false, error: `tree ${r.status}: ${await r.text()}` };
  const newTree = (await r.json()).sha;
  // 4. 建 commit
  r = await githubFetch(env, `${api}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message, tree: newTree, parents: [headSha],
      author: COMMIT_AUTHOR, committer: COMMIT_AUTHOR,
    }),
  });
  if (!r.ok) return { ok: false, error: `commit-create ${r.status}: ${await r.text()}` };
  const newCommit = (await r.json()).sha;
  // 5. 更新分支 ref
  r = await githubFetch(env, `${api}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit }),
  });
  if (!r.ok) return { ok: false, error: `ref-update ${r.status}: ${await r.text()}` };
  return { ok: true, commit: newCommit };
}

async function githubFetch(env, url, init = {}) {
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "reports.kevinhung.org-admin",
    ...(init.headers || {}),
  };
  if (init.body) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, { ...init, headers });
}

/** 取 GitHub 檔案，回傳 {sha, content (decoded utf-8)} 或 null。 */
async function githubGetFile(env, path) {
  const resp = await githubFetch(
    env,
    `https://api.github.com/repos/${GH_REPO}/contents/${encodePath(path)}?ref=${GH_BRANCH}`
  );
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`GitHub GET ${path} ${resp.status}`);
  const data = await resp.json();
  // GitHub 回傳 base64 with newlines
  const b64 = (data.content || "").replace(/\n/g, "");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const content = new TextDecoder("utf-8").decode(bytes);
  return { sha: data.sha, content };
}

/** 寫入或更新 GitHub 檔案。 */
async function githubPutFile(env, path, content, message) {
  // 先抓 SHA（如果存在）
  const existing = await githubGetFile(env, path).catch(() => null);

  // utf-8 → base64
  const bytes = new TextEncoder().encode(content);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);

  const body = {
    message,
    content: b64,
    branch: GH_BRANCH,
    author: COMMIT_AUTHOR,
    committer: COMMIT_AUTHOR,
  };
  if (existing) body.sha = existing.sha;

  const resp = await githubFetch(
    env,
    `https://api.github.com/repos/${GH_REPO}/contents/${encodePath(path)}`,
    { method: "PUT", body: JSON.stringify(body) }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    return { ok: false, error: `${resp.status}: ${errText}` };
  }
  const data = await resp.json();
  return { ok: true, commit: data.commit?.sha };
}

// ============ utils ============

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

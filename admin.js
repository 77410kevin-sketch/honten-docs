/* reports.kevinhung.org — 首頁渲染 + 編輯模式（單一 source of truth: meta.json） */
(function () {
  "use strict";

  const STATE = {
    editing: false,
    meta: null,          // 來自 /api/meta
    files: [],           // 根目錄（鎖定區）檔案，來自 /api/list-files
    publicFiles: [],     // share/（公用區）檔案
    sortables: [],
    dirty: false,
    loaded: false,
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }
  const escAttr = (s) => escHtml(s).replace(/`/g, "&#96;");

  // ============ 載入 + 渲染（瀏覽模式） ============

  async function loadAndRender() {
    showLoading("載入中…");
    try {
      const [m, f] = await Promise.all([
        fetch("/api/meta").then((r) => r.json()),
        fetch("/api/list-files").then((r) => r.json()),
      ]);
      if (m.error) throw new Error("meta: " + m.error);
      if (f.error) throw new Error("list: " + f.error);

      STATE.meta = m;
      STATE.files = f.files || [];
      STATE.publicFiles = f.public || [];
      STATE.loaded = true;
      renderAll();
      hideLoading();
    } catch (e) {
      hideLoading();
      $("#sections").innerHTML =
        '<div class="alert alert-danger">載入失敗：' + escHtml(e.message) +
        '<br><small>請確認 Cloudflare Worker 的 GITHUB_TOKEN secret 已正確設定</small></div>';
    }
  }

  function enterEditMode() {
    if (!STATE.loaded) {
      alert("資料還沒載入完畢，請稍候");
      return;
    }
    STATE.editing = true;
    STATE.dirty = false;
    document.body.classList.add("editing");
    $("#btnEdit").textContent = "✕ 結束編輯";
    renderAll();
  }

  function exitEditMode(force = false) {
    if (!force && STATE.dirty &&
        !confirm("⚠️ 有未儲存變更！\n\n按「取消」回去先點「💾 儲存」\n按「確定」會丟掉變更")) return;
    location.reload();
  }

  // ============ 渲染（瀏覽 + 編輯共用） ============

  function renderAll() {
    const sections = $("#sections");
    sections.innerHTML = "";

    // 已分類的檔
    const classified = new Set();
    STATE.meta.categories.forEach((c) =>
      c.items.forEach((i) => classified.add(i.file)));

    // 過濾已分類但檔已不存在的 item
    STATE.meta.categories.forEach((c) => {
      c.items = c.items.filter((i) => STATE.files.includes(i.file));
    });

    // 未分類的 → misc（套用 misc_overrides 的自訂顯示資訊）
    const overrides = STATE.meta.misc_overrides || {};
    const miscFiles = STATE.files.filter((f) => !classified.has(f));
    const miscCat = {
      id: "misc",
      title: (STATE.meta.misc_category || {}).title || "📋 其他文件",
      items: miscFiles.map((f) => {
        const o = overrides[f] || {};
        return {
          file: f,
          icon: o.icon || "📄",
          label: o.label != null ? o.label : "右鍵上傳",
          name: o.name || f,
          desc: o.desc || "",
        };
      }),
      _isMisc: true,
    };

    const allCats = [...STATE.meta.categories, miscCat];
    allCats.forEach((cat) => {
      // 瀏覽模式：空分類不顯示；編輯模式：仍顯示供拖入
      if (!STATE.editing && cat.items.length === 0 && !cat._isMisc) return;
      sections.appendChild(renderSection(cat));
    });

    // 公用區（share/）— 有公開檔或編輯模式時顯示
    const pubFiles = STATE.publicFiles || [];
    if (pubFiles.length || STATE.editing) {
      sections.appendChild(renderPublicSection(pubFiles));
    }

    // 編輯模式才顯示「新增分類」按鈕
    if (STATE.editing) {
      const adder = document.createElement("div");
      adder.className = "text-center mb-5";
      adder.innerHTML =
        '<button class="btn btn-outline-primary btn-lg" data-action="add-cat">+ 新增分類</button>';
      sections.appendChild(adder);
      enableSortable();
    } else {
      // 銷毀拖曳實例
      STATE.sortables.forEach((s) => s.destroy());
      STATE.sortables = [];
    }
  }

  function renderSection(cat) {
    const section = document.createElement("section");
    section.dataset.catId = cat.id;
    if (cat._isMisc) section.dataset.misc = "1";

    const headerActions = cat._isMisc
      ? ""
      : `<div>
           <button class="btn btn-sm btn-outline-danger"
                   data-action="del-cat" data-cat-id="${escAttr(cat.id)}">🗑 刪除分類</button>
         </div>`;

    section.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3 mt-2">
        <h3 class="mb-0">
          <span class="cat-title" contenteditable="${cat._isMisc ? "false" : "true"}"
                data-cat-id="${escAttr(cat.id)}">${escHtml(cat.title)}</span>
        </h3>
        ${headerActions}
      </div>
      <div class="row g-3 mb-5 cards-grid" data-cat-id="${escAttr(cat.id)}"></div>
    `;
    const grid = section.querySelector(".cards-grid");
    cat.items.forEach((item) => grid.appendChild(renderCard(item)));
    return section;
  }

  function renderCard(item) {
    const col = document.createElement("div");
    col.className = "col-md-6 col-lg-4 admin-card-wrap";
    col.dataset.file = item.file;
    col.dataset.itemJson = JSON.stringify(item);
    col.innerHTML = `
      <div class="card report-card shadow-sm position-relative">
        <div class="admin-card-actions">
          <button class="btn btn-sm btn-success" title="設為公開（移到公用區，任何人有連結可看）"
                  data-action="make-public">🌐</button>
          <button class="btn btn-sm btn-light" title="編輯卡片資訊"
                  data-action="edit-card">✏️</button>
          <button class="btn btn-sm btn-light" title="從分類移除（檔案保留）"
                  data-action="remove-card">✕</button>
          <button class="btn btn-sm btn-danger" title="完全刪除這個 HTML 檔"
                  data-action="delete-file">🗑</button>
        </div>
        <a href="${escAttr(item.file)}.html">
          <div class="icon">${escHtml(item.icon || "📄")}</div>
          <span class="category-label">${escHtml(item.label || "")}</span>
          <h5>${escHtml(item.name || item.file)}</h5>
          <p class="desc">${escHtml(item.desc || "")}</p>
        </a>
      </div>
    `;
    return col;
  }

  // 公用區（share/）區塊：列出公開檔，可移回鎖定 / 複製連結
  function renderPublicSection(files) {
    const section = document.createElement("section");
    section.dataset.public = "1";
    const cards = files.map((f) => `
      <div class="col-md-6 col-lg-4">
        <div class="card report-card shadow-sm position-relative" style="border:2px solid #d1f0df;">
          <div class="admin-card-actions">
            <button class="btn btn-sm btn-light" title="複製公開連結"
                    data-action="copy-public" data-file="${escAttr(f)}">🔗</button>
            <button class="btn btn-sm btn-warning" title="移回鎖定區（不再公開）"
                    data-action="make-private" data-file="${escAttr(f)}">🔒</button>
          </div>
          <a href="/share/${escAttr(f)}.html" target="_blank">
            <div class="icon">🌐</div>
            <span class="category-label" style="color:#198754;">公開・免登入</span>
            <h5>${escHtml(f)}</h5>
            <p class="desc">reports.kevinhung.org/share/${escHtml(f)}</p>
          </a>
        </div>
      </div>
    `).join("");
    section.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3 mt-2">
        <h3 class="mb-0">🌐 公用區<small class="text-muted fs-6 ms-2">任何人有連結即可看・免登入</small></h3>
      </div>
      <div class="row g-3 mb-5">${
        cards || '<div class="col-12 text-muted py-3">（目前沒有公開報告。在上面任一報告卡按 🌐 即可設為公開）</div>'
      }</div>
    `;
    return section;
  }

  function enableSortable() {
    STATE.sortables.forEach((s) => s.destroy());
    STATE.sortables = [];
    $$(".cards-grid").forEach((grid) => {
      const s = Sortable.create(grid, {
        group: "cards",
        animation: 150,
        // 多個事件都標記 dirty，保險起見（拖曳到不同分類用 onAdd / onRemove）
        onEnd: () => markDirty(),
        onAdd: () => markDirty(),
        onRemove: () => markDirty(),
        onUpdate: () => markDirty(),
      });
      STATE.sortables.push(s);
    });
  }

  function markDirty() {
    STATE.dirty = true;
    const b = $("#btnSave");
    if (b) {
      b.classList.add("dirty");
      b.textContent = "💾 儲存 *";
    }
    document.title = "* Kevin Reports — 未儲存";
  }

  // 防止意外關閉頁面 / 上一頁丟失變更
  window.addEventListener("beforeunload", (e) => {
    if (STATE.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ============ 從 DOM 收集回 meta ============

  function syncFromDOM() {
    const newCats = [];
    const miscOverrides = {};
    $$("section[data-cat-id]").forEach((sec) => {
      const catId = sec.dataset.catId;
      const title = (sec.querySelector(".cat-title")?.textContent || "").trim();
      const items = [];
      sec.querySelectorAll(".cards-grid > [data-file]").forEach((card) => {
        try {
          items.push(JSON.parse(card.dataset.itemJson));
        } catch {
          // 萬一 JSON 壞了，用基本值
          items.push({
            file: card.dataset.file, icon: "📄",
            label: "", name: card.dataset.file, desc: "",
          });
        }
      });
      if (sec.dataset.misc === "1") {
        // misc 不存成正式分類，但保留每張卡的自訂顯示資訊（依檔名）
        items.forEach((it) => {
          miscOverrides[it.file] = {
            icon: it.icon, label: it.label, name: it.name, desc: it.desc,
          };
        });
        return;
      }
      newCats.push({ id: catId, title, items });
    });
    return { ...STATE.meta, categories: newCats, misc_overrides: miscOverrides };
  }

  // ============ 行為 handlers ============

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "toggle-edit") {
      STATE.editing ? exitEditMode() : enterEditMode();
    } else if (action === "save") {
      saveAll();
    } else if (action === "add-cat") {
      addCategory();
    } else if (action === "del-cat") {
      deleteCategory(btn.dataset.catId);
    } else if (action === "edit-card") {
      editCard(btn.closest("[data-file]"));
    } else if (action === "remove-card") {
      removeFromCat(btn.closest("[data-file]"));
    } else if (action === "delete-file") {
      deleteFile(btn.closest("[data-file]"));
    } else if (action === "make-public") {
      const f = btn.closest("[data-file]")?.dataset.file;
      if (f) movePublic(f, "public");
    } else if (action === "make-private") {
      movePublic(btn.dataset.file, "private");
    } else if (action === "copy-public") {
      copyPublicLink(btn.dataset.file);
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.classList.contains("cat-title")) markDirty();
  });

  function addCategory() {
    const title = prompt("新分類標題（例：📝 個人筆記）：");
    if (!title) return;
    // 先把目前 DOM 狀態（包含拖曳）收回，再加新分類
    STATE.meta = syncFromDOM();
    const id = "cat_" + Date.now();
    STATE.meta.categories.push({ id, title: title.trim(), items: [] });
    renderAll();
    markDirty();
  }

  function deleteCategory(catId) {
    if (!confirm("刪除這個分類？卡片會自動轉到「其他文件」")) return;
    // 先把 DOM 變更收回 STATE.meta（保留拖曳結果），再刪分類
    STATE.meta = syncFromDOM();
    STATE.meta.categories = STATE.meta.categories.filter((c) => c.id !== catId);
    renderAll();
    markDirty();
  }

  function editCard(card) {
    const cur = JSON.parse(card.dataset.itemJson);
    const icon = prompt("圖示（emoji）", cur.icon || "📄");
    if (icon === null) return;
    const name = prompt("卡片標題", cur.name || cur.file);
    if (name === null) return;
    const label = prompt("小標籤（例如：每週更新）", cur.label || "");
    if (label === null) return;
    const desc = prompt("描述", cur.desc || "");
    if (desc === null) return;

    const updated = { ...cur, icon, name, label, desc };
    card.dataset.itemJson = JSON.stringify(updated);
    const c = card.querySelector(".card");
    c.querySelector(".icon").textContent = icon || "📄";
    c.querySelector(".category-label").textContent = label;
    c.querySelector("h5").textContent = name;
    c.querySelector(".desc").textContent = desc;
    markDirty();
  }

  function removeFromCat(card) {
    if (!confirm("從這個分類移除？檔案會出現在「其他文件」")) return;
    card.remove();
    markDirty();
  }

  async function deleteFile(card) {
    const file = card.dataset.file;
    if (!confirm(`⚠️ 完全刪除 ${file}.html？\n會從 GitHub repo 移除這個檔案，無法復原！`)) return;
    showLoading("刪除中…");
    try {
      const r = await fetch("/api/delete-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file + ".html" }),
      });
      const result = await r.json();
      hideLoading();
      if (result.success) {
        card.remove();
        STATE.files = STATE.files.filter((f) => f !== file);
        toast("✅ 已刪除 " + file);
        markDirty();
      } else {
        alert("❌ " + (result.error || JSON.stringify(result)));
      }
    } catch (e) {
      hideLoading();
      alert("❌ 錯誤：" + e.message);
    }
  }

  async function movePublic(file, to) {
    const isPub = to === "public";
    const verb = isPub ? "設為公開（移到公用區）" : "移回鎖定區";
    const warn = isPub ? "\n⚠️ 之後任何人有連結就能看到，不需登入。" : "";
    if (!confirm(`確定要把「${file}」${verb}？${warn}`)) return;
    showLoading(isPub ? "設為公開中…" : "移回鎖定中…");
    try {
      const r = await fetch("/api/move-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file + ".html", to }),
      });
      const result = await r.json();
      hideLoading();
      if (result.success) {
        toast("✅ " + (result.message || "已搬移"));
        await loadAndRender();   // 檔案位置已變，重抓清單重畫（編輯模式會保留）
      } else {
        alert("❌ " + (result.error || JSON.stringify(result)));
      }
    } catch (e) {
      hideLoading();
      alert("❌ 錯誤：" + e.message);
    }
  }

  function copyPublicLink(file) {
    const url = location.origin + "/share/" + file;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(
        () => toast("🔗 已複製連結：" + url),
        () => prompt("複製這個公開連結：", url)
      );
    } else {
      prompt("複製這個公開連結：", url);
    }
  }

  async function saveAll() {
    const newMeta = syncFromDOM();
    showLoading("儲存中…");
    try {
      const r = await fetch("/api/save-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMeta),
      });
      const result = await r.json();
      hideLoading();
      if (result.success) {
        STATE.dirty = false;
        toast("✅ 儲存成功，35 秒後自動重整");
        setTimeout(() => location.reload(), 35000);
      } else {
        alert("❌ " + (result.error || JSON.stringify(result)));
      }
    } catch (e) {
      hideLoading();
      alert("❌ 錯誤：" + e.message);
    }
  }

  // ============ 初始載入 ============

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadAndRender);
  } else {
    loadAndRender();
  }

  // ============ UI helpers ============

  function showLoading(msg) {
    let el = $("#adminLoading");
    if (!el) {
      el = document.createElement("div");
      el.id = "adminLoading";
      el.className = "admin-overlay";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "flex";
  }
  function hideLoading() {
    const el = $("#adminLoading");
    if (el) el.style.display = "none";
  }
  function toast(msg) {
    const t = document.createElement("div");
    t.className = "admin-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("fade-out"), 3500);
    setTimeout(() => t.remove(), 4500);
  }
})();

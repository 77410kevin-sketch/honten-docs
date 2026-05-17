/* reports.kevinhung.org admin overlay — 編輯儀表板的客戶端邏輯 */
(function () {
  "use strict";

  const STATE = {
    editing: false,
    meta: null,          // 來自 /api/meta
    files: [],           // 來自 /api/list-files
    sortables: [],
    dirty: false,
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }
  const escAttr = (s) => escHtml(s).replace(/`/g, "&#96;");

  // ============ 進入 / 退出編輯模式 ============

  async function enterEditMode() {
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
      STATE.editing = true;
      STATE.dirty = false;

      document.body.classList.add("editing");
      renderEditMode();
      $("#btnEdit").textContent = "✕ 結束編輯";
      hideLoading();
    } catch (e) {
      hideLoading();
      alert("載入失敗：" + e.message);
    }
  }

  function exitEditMode(force = false) {
    if (!force && STATE.dirty &&
        !confirm("有未儲存變更，確定要離開？")) return;
    location.reload();
  }

  // ============ Edit-mode 渲染 ============

  function renderEditMode() {
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

    // 未分類的 → misc
    const miscFiles = STATE.files.filter((f) => !classified.has(f));
    const miscCat = {
      id: "misc",
      title: (STATE.meta.misc_category || {}).title || "📋 其他文件",
      items: miscFiles.map((f) => ({
        file: f, icon: "📄", label: "右鍵上傳", name: f, desc: "",
      })),
      _isMisc: true,
    };

    const allCats = [...STATE.meta.categories, miscCat];
    allCats.forEach((cat) => sections.appendChild(renderSection(cat)));

    // 新增分類按鈕
    const adder = document.createElement("div");
    adder.className = "text-center mb-5";
    adder.innerHTML =
      '<button class="btn btn-outline-primary btn-lg" data-action="add-cat">+ 新增分類</button>';
    sections.appendChild(adder);

    enableSortable();
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

  function enableSortable() {
    STATE.sortables.forEach((s) => s.destroy());
    STATE.sortables = [];
    $$(".cards-grid").forEach((grid) => {
      const s = Sortable.create(grid, {
        group: "cards",
        animation: 150,
        onEnd: () => markDirty(),
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
  }

  // ============ 從 DOM 收集回 meta ============

  function syncFromDOM() {
    const newCats = [];
    $$("section[data-cat-id]").forEach((sec) => {
      if (sec.dataset.misc === "1") return; // misc 動態產生，不存
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
      newCats.push({ id: catId, title, items });
    });
    return { ...STATE.meta, categories: newCats };
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
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.classList.contains("cat-title")) markDirty();
  });

  function addCategory() {
    const title = prompt("新分類標題（例：📝 個人筆記）：");
    if (!title) return;
    const id = "cat_" + Date.now();
    STATE.meta.categories.push({ id, title: title.trim(), items: [] });
    renderEditMode();
    markDirty();
  }

  function deleteCategory(catId) {
    if (!confirm("刪除這個分類？卡片會自動轉到「其他文件」")) return;
    STATE.meta.categories = STATE.meta.categories.filter((c) => c.id !== catId);
    renderEditMode();
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

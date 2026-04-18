

# 第 1 週：什麼是後端？請求／回應循環

---

## 一、用餐廳來理解「後端」

想像你走進一間餐廳。你坐下來、拿起菜單、跟服務生說：「我要一份牛排，七分熟。」

接著發生了什麼事？

1. **你（客人）** — 提出需求（「我要牛排」）
2. **服務生** — 把你的需求帶進廚房
3. **廚房** — 收到訂單、從冰箱拿食材、按照食譜料理
4. **服務生** — 把做好的牛排端回來給你

在網頁的世界裡，對應關係是這樣的：

| 餐廳角色 | 網頁世界 | 說明 |
|---------|---------|------|
| 客人 | **瀏覽器（Browser）** | 使用者看到的畫面，發出請求 |
| 菜單 | **網頁介面（HTML/CSS/JS）** | 前端，讓使用者可以操作的介面 |
| 服務生 | **Web 伺服器（FastAPI）** | 接收請求、轉交處理、回傳結果 |
| 廚房 | **後端程式邏輯** | 實際處理資料的地方 |
| 冰箱／倉庫 | **資料庫（SQLite）** | 儲存所有食材（資料）的地方 |
| 食譜 | **商業邏輯（Business Logic）** | 決定「怎麼處理」的規則 |

**後端（Backend）** 就是客人看不到的「廚房」。它負責接收請求、查詢或寫入資料庫、執行商業邏輯，最後把結果送回給前端顯示。

---

## 二、請求／回應循環（Request / Response Cycle）

### 這是什麼？

每一次你在瀏覽器輸入網址、點一個按鈕、送出一張表單，背後都發生了一次完整的 **請求→處理→回應** 循環。這是整個 Web 運作最核心的機制。

用一張流程來看：

```
使用者點擊「查詢樣品」按鈕
        │
        ▼
  ① 瀏覽器發出 HTTP Request（請求）
     GET /samples?status=pending
        │
        ▼
  ② FastAPI 路由接收請求
     找到對應的處理函式
        │
        ▼
  ③ 後端程式執行商業邏輯
     → 透過 SQLAlchemy 查詢 SQLite 資料庫
     → 找出所有 status='pending' 的樣品
        │
        ▼
  ④ 組裝 HTTP Response（回應）
     → 用 Jinja2 把資料填入 HTML 模板
     → 回傳完整的網頁給瀏覽器
        │
        ▼
  ⑤ 瀏覽器收到 HTML，畫面顯示結果
```

### 為什麼重要？

因為 **你寫的每一行後端程式碼，都是在處理這個循環裡的某一個環節**。理解這個循環，你就能回答以下問題：

- 使用者按下按鈕後，程式到底做了什麼？
- 為什麼畫面沒有更新？（可能是請求沒發出、路由沒對上、資料庫沒查到）
- 資料是怎麼從資料庫跑到畫面上的？

不懂這個循環，寫程式就像在廚房裡閉著眼睛煮菜 — 你不知道食材從哪來、菜要端去哪。

---

## 三、怎麼用？在 FastAPI 中實作請求／回應

### HTTP 方法速查表

| HTTP 方法 | 用途 | 餐廳比喻 | HonTen 範例 |
|-----------|------|---------|-------------|
| `GET` | 讀取資料 | 「請給我看菜單」 | 查詢樣品列表 |
| `POST` | 新增資料 | 「我要點這道菜」 | 送出新的工程變更單 |
| `PUT` | 更新資料 | 「牛排改成五分熟」 | 修改送樣申請內容 |
| `DELETE` | 刪除資料 | 「取消那道菜」 | 刪除一筆草稿紀錄 |

### 程式碼範例 1：最簡單的請求與回應

我們先從最基本的開始 — 讓 FastAPI 接收一個請求，然後回傳一段文字。

```python
# main.py — 鴻騰電子數位管理系統的進入點

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

# 建立 FastAPI 應用程式（這就是你的「餐廳」）
app = FastAPI(title="鴻騰電子數位管理系統")

# 設定 Jinja2 模板資料夾（這就是你的「餐盤樣式」）
templates = Jinja2Templates(directory="templates")


# -------- 路由（Route）= 菜單上的每一道菜 --------

@app.get("/", response_class=HTMLResponse)
async def homepage(request: Request):
    """
    當使用者瀏覽首頁時，這個函式會被觸發。
    
    請求（Request）：使用者在瀏覽器輸入 http://localhost:8000/
    回應（Response）：回傳一個 HTML 頁面
    """
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "system_name": "鴻騰電子數位管理系統",
            "greeting": "歡迎回來，Kevin！"
        }
    )


@app.get("/health")
async def health_check():
    """
    系統健康檢查 — 最簡單的請求/回應範例。
    不需要查資料庫，直接回傳 JSON。
    """
    return {
        "status": "running",
        "system": "HonTen Digital Management",
        "version": "1.0.0"
    }
```

**逐行解讀：**

- `@app.get("/")` — 告訴 FastAPI：「當有人用 GET 方法訪問 `/` 這個路徑時，請執行下面這個函式。」這就像菜單上寫著「招牌牛排 → 廚房 3 號區製作」。
- `async def homepage(request: Request)` — 這是一個**非同步函式**，`request` 參數包含了使用者送來的所有資訊（瀏覽器類型、來源 IP、附帶的資料等）。
- `templates.TemplateResponse(...)` — 用 Jinja2 模板引擎把資料「填入」HTML 模板，組裝成完整的網頁回傳。

### 程式碼範例 2：處理送樣申請（完整的請求→資料庫→回應）

這個範例更貼近鴻騰系統的實際場景 — 使用者送出一張「送樣申請單」，後端要把資料存進資料庫。

```python
# routers/sample_requests.py — 送樣申請模組

from fastapi import APIRouter, Request, Form
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import insert, select
from database import async_session
from models import SampleRequest  # SQLAlchemy 模型

router = APIRouter(prefix="/samples", tags=["送樣管理"])
templates = Jinja2Templates(directory="templates")


# -------- GET：顯示「新增送樣申請」表單 --------
@router.get("/new", name="sample_new_form")
async def show_new_sample_form(request: Request):
    """
    請求：使用者點擊「新增送樣申請」按鈕
    回應：回傳一張空白表單頁面
    
    這一步還不需要查資料庫，只是把表單 HTML 送給瀏覽器。
    """
    return templates.TemplateResponse(
        "samples/new.html",
        {"request": request, "page_title": "新增送樣申請"}
    )


# -------- POST：接收表單資料，寫入資料庫 --------
@router.post("/new", name="sample_create")
async def create_sample_request(
    request: Request,
    customer_name: str = Form(...),      # 客戶名稱（必填）
    product_model: str = Form(...),      # 產品型號（必填）
    quantity: int = Form(...),           # 數量
    note: str = Form(default=""),        # 備註（選填）
):
    """
    完整的請求/回應循環：
    
    ① 使用者在表單填入資料，按下「送出」
    ② 瀏覽器發出 POST /samples/new，夾帶表單資料
    ③ FastAPI 透過 Form(...) 取出每個欄位的值
    ④ 用 SQLAlchemy 把資料寫入 SQLite 資料庫
    ⑤ 重新導向到送樣列表頁（另一個 GET 請求）
    """
    
    # — 第 ④ 步：寫入資料庫 —
    async with async_session() as session:
        new_sample = SampleRequest(
            customer_name=customer_name,
            product_model=product_model,
            quantity=quantity,
            note=note,
            status="pending"  # 預設狀態：待審核
        )
        session.add(new_sample)
        await session.commit()

    # — 第 ⑤ 步：重新導向（Post/Redirect/Get 模式）—
    return RedirectResponse(url="/samples", status_code=303)


# -------- GET：查詢送樣列表 --------
@router.get("/", name="sample_list")
async def list_samples(request: Request, status: str = None):
    """
    請求：使用者瀏覽送樣列表（可選擇篩選狀態）
    回應：從資料庫撈出資料，填入模板，回傳 HTML
    """
    async with async_session() as session:
        query = select(SampleRequest).order_by(
            SampleRequest.created_at.desc()
        )
        
        # 如果使用者有指定篩選條件
        if status:
            query = query.where(SampleRequest.status == status)
        
        result = await session.execute(query)
        samples = result.scalars().all()

    return templates.TemplateResponse(
        "samples/list.html",
        {
            "request": request,
            "page_title": "送樣申請列表",
            "samples": samples,
            "current_filter": status
        }
    )
```

**這段程式碼展示了三種情境：**

1. **GET `/samples/new`** — 單純回傳頁面，不碰資料庫（像是服務生遞菜單給你）
2. **POST `/samples/new`** — 接收表單資料、寫入資料庫、重新導向（像是你點完餐，服務生把單子送進廚房）
3. **GET `/samples`** — 從資料庫撈資料、組裝成頁面回傳（像是服務生把做好的菜端上桌）

---

## 四、在鴻騰專案中的實際應用

鴻騰電子數位管理系統的每一個功能頁面，都是一次請求／回應循環：

| 使用者操作 | HTTP 方法 | 路徑 | 後端做的事 |
|-----------|-----------|------|-----------|
| 開啟首頁 | GET | `/` | 回傳歡迎頁面 |
| 查看送樣列表 | GET | `/samples` | 查詢資料庫 → 回傳列表 |
| 填寫送樣申請 | GET | `/samples/new` | 回傳空白表單 |
| 送出送樣申請 | POST | `/samples/new` | 寫入資料庫 → 導向列表 |
| 查看工程變更單 | GET | `/engforms` | 查詢資料庫 → 回傳列表 |
| 審核簽核 | POST | `/engforms/{id}/approve` | 更新狀態 → 導向詳情頁 |
| 使用者登入 | POST | `/auth/login` | 驗證帳密 → 建立 Session |

**你未來 12 週寫的每一個功能，都逃不出這個循環。** 把這個觀念刻進腦袋，後面的課程你會學得更快。

---

## 五、關鍵觀念小結

```
使用者動作 → HTTP Request → FastAPI 路由 → 商業邏輯 → 資料庫操作 → HTTP Response → 畫面更新
```

記住這條線。當系統出問題時，沿著這條線逐步檢查，你就能找到問題出在哪一段。

---

## 📝 本週學習任務

### 任務 1：建立並啟動你的第一個 FastAPI 應用程式
建立 `main.py`，把上面「程式碼範例 1」的內容貼進去，然後在終端機執行：
```bash
uvicorn main:app --reload
```
打開瀏覽器訪問 `http://127.0.0.1:8000/health`，確認你能看到 JSON 回應。再訪問 `http://127.0.0.1:8000/docs`，體驗 FastAPI 自動產生的互動式 API 文件。

### 任務 2：新增 3 個自訂路由
在 `main.py` 中自己新增至少 3 個路由，模擬鴻騰系統的不同頁面。例如：
- `GET /about` → 回傳 `{"page": "關於鴻騰電子"}`
- `GET /samples/count` → 回傳 `{"total_samples": 42}`
- `GET /users/me` → 回傳 `{"name": "Kevin", "role": "管理者"}`

每個路由都寫上中文註解，說明「這個路由的請求是什麼、回應是什麼」。

### 任務 3：用紙筆畫出請求／回應流程圖
選擇鴻騰系統中的一個功能（例如：「員工登入」或「查詢客戶工程變更單」），用紙筆畫出從「使用者點擊按鈕」到「畫面顯示結果」的完整流程。標示出：瀏覽器、FastAPI、資料庫分別在哪一步介入。這張圖在後續幾週會不斷用到，請拍照留存。

---

> **下週預告：** 第 2 週我們將進入「資料庫基礎與 SQLAlchemy 模型設計」，你會學到如何定義 `SampleRequest`、`EngForm`、`User` 這些模型，讓資料有結構地住進 SQLite 資料庫裡。
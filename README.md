# 📈 Telegram Stock News Bot (NestJS + PostgreSQL + Prisma)

Hệ thống Bot Telegram tự động theo dõi, thu thập tin tức chứng khoán mới nhất từ **CafeF** và gửi thông báo tức thì tới người dùng hoặc các kênh/nhóm Telegram.

---

## 🚀 Công nghệ sử dụng

- **Framework**: [NestJS](https://nestjs.com/) (TypeScript)
- **Cơ sở dữ liệu**: PostgreSQL
- **ORM**: [Prisma ORM](https://www.prisma.io/) v7
- **Telegram Library**: `telegraf`
- **RSS & HTML Parser**: `rss-parser`, `cheerio`
- **Scheduler**: `@nestjs/schedule` (CronJob quét tin định kỳ)

---

## 🛠️ Hướng dẫn cài đặt & Khởi chạy

### 1. Cấu hình môi trường (`.env`)

Tạo hoặc chỉnh sửa file `.env` tại thư mục gốc dự án:

```env
# PostgreSQL Connection String
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/stocknews_db?schema=public"

# Telegram Bot Token (Lấy từ @BotFather trên Telegram)
TELEGRAM_BOT_TOKEN="YOUR_TELEGRAM_BOT_TOKEN_HERE"

# Cron schedule (Mặc định: Quét tin tức mỗi 1 phút)
CRON_SCHEDULE="*/1 * * * *"
```

> **Cách lấy TELEGRAM_BOT_TOKEN**:
> 1. Mở Telegram, tìm kiếm [@BotFather](https://t.me/BotFather).
> 2. Gõ `/newbot` và làm theo hướng dẫn để tạo bot mới.
> 3. Copy chuỗi token được cấp và dán vào `TELEGRAM_BOT_TOKEN` trong `.env`.

---

### 2. Khởi chạy PostgreSQL Container (Option Local)

Nếu sử dụng PostgreSQL trên máy local qua Docker:

```bash
docker compose up -d
```

---

### 3. Đẩy Schema Prisma vào Database

```bash
pnpm exec prisma db push
```

---

### 4. Khởi chạy ứng dụng NestJS

```bash
# Chế độ Development (Auto-reload)
pnpm run start:dev

# Chế độ Production
pnpm run build
pnpm run start:prod
```

---

## 📱 Các lệnh Telegram Bot hỗ trợ

| Lệnh | Mô tả |
|---|---|
| `/start` | Đăng ký tự động và hiển thị lời chào mừng |
| `/latest` | Xem 5 tin tức chứng khoán mới nhất |
| `/stock <MÃ>` | Tìm kiếm tin tức theo mã cổ phiếu (ví dụ: `/stock SSI`, `/stock HPG`) |
| `/subscribe` | Bật nhận thông báo tin tức tự động |
| `/unsubscribe` | Tắt nhận thông báo tự động |
| `/help` | Xem hướng dẫn sử dụng bot |

---

## ⚙️ Cơ chế hoạt động

1. **Quét tin định kỳ (CronJob)**: Cứ mỗi 1-3 phút, `SchedulerService` gọi `NewsFetcherService` để tải RSS feed từ CafeF (`https://cafef.vn/thi-truong-chung-khoan.rss`).
2. **Lọc tin mới & Lưu vết (Prisma + Postgres)**: `NewsService` kiểm tra xem bài viết đã tồn tại trong database hay chưa. Nếu là tin mới, tin sẽ được lưu vào cơ sở dữ liệu PostgreSQL.
3. **Phát tin nhắn (Broadcast)**: `TelegramService` phát thông báo định dạng HTML đẹp mắt (gồm tiêu đề, tóm tắt, đường dẫn, mã cổ phiếu liên quan, thời gian) tới tất cả các Chat ID đã đăng ký (`/subscribe`).

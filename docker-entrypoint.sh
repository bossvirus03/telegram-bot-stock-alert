#!/bin/sh
set -e

# Tự động đồng bộ schema Prisma sang database khi khởi động container (nếu có cấu hình DATABASE_URL)
if [ -n "$DATABASE_URL" ]; then
  echo "🚀 [Northflank] Đang kiểm tra và đồng bộ cấu trúc Database qua Prisma..."
  npx prisma db push --skip-generate || echo "⚠️ [Northflank] Prisma db push thất bại hoặc database chưa sẵn sàng, tiếp tục chạy ứng dụng..."
fi

# Chạy lệnh chính (CMD)
exec "$@"

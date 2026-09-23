# ==========================================
# 1. Build Stage
# ==========================================
FROM node:20-alpine AS builder

# Cài đặt OpenSSL và libc6-compat cần thiết cho Prisma Engine trên Alpine
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy dependency definition files
COPY package*.json ./
COPY prisma ./prisma/

# Cài đặt toàn bộ dependencies (bao gồm cả devDependencies để build)
RUN npm ci

# Copy toàn bộ mã nguồn
COPY . .

# Generate Prisma Client & Build source code NestJS sang dist/
RUN npx prisma generate
RUN npm run build

# Xoá bớt devDependencies không cần thiết
RUN npm prune --production

# ==========================================
# 2. Production Runtime Stage
# ==========================================
FROM node:20-alpine AS runner

# Cài đặt OpenSSL, libc6-compat và dumb-init để xử lý process signal mượt mà
RUN apk add --no-cache openssl libc6-compat dumb-init

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Tạo non-root user để tăng tính bảo mật
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy kết quả build và dependencies từ builder stage
COPY --chown=nestjs:nodejs --from=builder /app/package*.json ./
COPY --chown=nestjs:nodejs --from=builder /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs --from=builder /app/dist ./dist
COPY --chown=nestjs:nodejs --from=builder /app/prisma ./prisma
COPY --chown=nestjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh

# Cấp quyền thực thi cho entrypoint script
RUN chmod +x ./docker-entrypoint.sh

# Chạy bằng user bảo mật non-root
USER nestjs

# Cổng mặc định
EXPOSE 3001

# Entrypoint kiểm tra và migrate database trước khi khởi động
ENTRYPOINT ["/usr/bin/dumb-init", "--", "./docker-entrypoint.sh"]

# Lệnh khởi chạy ứng dụng
CMD ["node", "dist/main.js"]

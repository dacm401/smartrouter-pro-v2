FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV production

# 安装 tsx 用于直接运行 TypeScript
RUN npm install -g tsx

# 复制 package 文件并安装依赖（包含 devDependencies）
COPY package*.json ./
RUN npm ci

# 复制源码
COPY src ./src
COPY tsconfig.json ./

EXPOSE 3001
CMD ["tsx", "src/index.ts"]

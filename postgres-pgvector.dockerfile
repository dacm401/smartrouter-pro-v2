FROM postgres:16-alpine
# pgvector 在 Alpine 仓库里是现成包，走 USTC mirror 不走 Docker proxy
RUN apk add --no-cache postgresql-pgvector

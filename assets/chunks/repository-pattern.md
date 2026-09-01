---
title: "Repository Pattern"
slug: repository-pattern
brief: "domain 定義介面，infra 提供實作。換 DB 一行不改 application。"
article: ddd-textbook-vs-real
date: 2026-06-14
---

# Repository Pattern

把資料存取從 application code 中抽離。**domain 層只看到「介面」**，**infrastructure 層提供具體實作**。中間用 DI container 綁起來。

## 兩個檔案

```typescript
// domain/repositories/conversation-repository.interface.ts
export interface ConversationRepository {
  getById(id: string): Promise<Conversation | null>;
  create(c: Conversation): Promise<Conversation>;
  save(c: Conversation): Promise<void>;
}
```

```typescript
// infrastructure/prisma-conversation-repository.ts（ORM 就住在這裡，只住這裡）
export class PrismaConversationRepository implements ConversationRepository {
  constructor(private prisma: PrismaClient) {}

  async getById(id: string) {
    const row = await this.prisma.conversation.findUnique({ where: { id } });
    return row ? toDomain(row) : null;     // prisma model → 你的 Conversation
  }
  async create(c: Conversation) {
    return toDomain(await this.prisma.conversation.create({ data: toRow(c) }));
  }
  async save(c: Conversation) {
    await this.prisma.conversation.update({ where: { id: c.id }, data: toRow(c) });
  }
}
```

## 為什麼這層值得做

**換 DB 那天 application 一行不改。** 換哪家 DB 只是換注入哪個實作，上面的業務 code 動都不動。

**測試時可以塞 in-memory mock，跑得快。**

```typescript
// 測試時注入一個記憶體版，不連 DB
class InMemoryConversationRepository implements ConversationRepository {
  private store = new Map<string, Conversation>();
  async getById(id) { return this.store.get(id) ?? null; }
  async create(c)   { this.store.set(c.id, c); return c; }
  async save(c)     { this.store.set(c.id, c); }
}

const repo = new InMemoryConversationRepository();
const chat = new ChatService(repo);   // ChatService 不知道換了實作，測試秒跑
```

**domain 邏輯保持純粹，不被 ORM / SQL 思維污染。**

```typescript
// 有 repository：業務邏輯只看到 domain 操作
async function archive(id, repo: ConversationRepository) {
  const c = await repo.getById(id);   // 不是 SELECT
  c.archive();                        // domain 行為
  await repo.save(c);                 // 不是 UPDATE
}

// 沒有 repository：SQL / ORM 思維滲進業務邏輯
async function archive(id) {
  const row = await db.query('SELECT * FROM conversations WHERE id=?', [id]);
  await orm.conversation.update({ where: { id }, data: { archived: true } });
}
```

## 跟 ORM 的關係

ORM（Hibernate / TypeORM / Prisma）本身**不是 Repository pattern**。ORM 提供 CRUD API 給你直接用。Repository 是在 ORM **再上一層**抽象，把「DB 細節」徹底隔離出 application。

有 ORM 不代表就有 Repository pattern。ORM 給你直接可用的 CRUD，Repository 是在它之上再包一層。

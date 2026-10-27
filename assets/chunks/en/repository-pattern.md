---
title: "Repository Pattern"
slug: repository-pattern
brief: "The domain defines the interface, infra provides the implementation. Switch DBs without changing one line of application code."
article: ddd-textbook-vs-real
date: 2026-06-14
---

# Repository Pattern

Pull data access out of the application code. **The domain layer sees only the interface**, and **the infrastructure layer provides the concrete implementation**. A DI (Dependency Injection) container connects the two, and decides at startup which implementation to inject.

## Two files

```typescript
// domain/repositories/conversation-repository.interface.ts
export interface ConversationRepository {
  getById(id: string): Promise<Conversation | null>;
  create(c: Conversation): Promise<Conversation>;
  save(c: Conversation): Promise<void>;
}
```

```typescript
// infrastructure/prisma-conversation-repository.ts (the ORM lives here, and only here)
export class PrismaConversationRepository implements ConversationRepository {
  constructor(private prisma: PrismaClient) {}

  async getById(id: string) {
    const row = await this.prisma.conversation.findUnique({ where: { id } });
    return row ? toDomain(row) : null;     // prisma model → the domain's Conversation
  }
  async create(c: Conversation) {
    return toDomain(await this.prisma.conversation.create({ data: toRow(c) }));
  }
  async save(c: Conversation) {
    await this.prisma.conversation.update({ where: { id: c.id }, data: toRow(c) });
  }
}
```

## Why this layer is worth it

**On the day you switch DBs, the application changes zero lines.** Which DB you use is only a matter of which implementation gets injected. The business code above it does not move.

**Tests can inject an in-memory mock, which runs fast.**

```typescript
// In tests, inject an in-memory version with no DB connection
class InMemoryConversationRepository implements ConversationRepository {
  private store = new Map<string, Conversation>();
  async getById(id) { return this.store.get(id) ?? null; }
  async create(c)   { this.store.set(c.id, c); return c; }
  async save(c)     { this.store.set(c.id, c); }
}

const repo = new InMemoryConversationRepository();
const chat = new ChatService(repo);   // ChatService does not know the implementation changed; tests run instantly
```

**No ORM or SQL appears in domain logic.**

```typescript
// With a repository: business logic sees only domain operations
async function archive(id, repo: ConversationRepository) {
  const c = await repo.getById(id);   // not SELECT
  c.archive();                        // domain behavior
  await repo.save(c);                 // not UPDATE
}

// Without a repository: SQL / ORM written straight into the business logic
async function archive(id) {
  const row = await db.query('SELECT * FROM conversations WHERE id=?', [id]);
  await orm.conversation.update({ where: { id }, data: { archived: true } });
}
```

## Relation to ORM

An ORM (Hibernate / TypeORM / Prisma) is itself **not the Repository pattern**. An ORM provides a CRUD API you can call directly. A Repository is **one more layer of abstraction above** the ORM, so the application never touches DB details at all.

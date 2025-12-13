# Performance-Focused Review - Optimization Deep Dive

## Scenario

Your API has performance issues. Response times for some endpoints are consistently over 2 seconds, and you want to conduct a performance-focused review of your API endpoint implementations. You want the AI reviewers to focus specifically on optimization opportunities without getting distracted by other issues.

**Focus**: Performance optimization
**Target Files**:
- `src/api/users.ts` (~150 lines)
- `src/api/products.ts` (~180 lines)
- `src/api/orders.ts` (~200 lines)

**Total**: ~530 lines
**Primary Concern**: Response time, database queries, memory usage
**Risk Level**: Medium (affecting user experience)

## When to Use This Pattern

- API endpoints are slow (> 500ms response time)
- Database query optimization needed
- Memory leaks suspected
- Want to identify performance bottlenecks
- N+1 query problems
- Caching opportunities
- Async/await optimization
- Algorithm optimization (O(n²) to O(n))
- Scaling concerns before increased traffic
- Performance regression detection

## Command

```bash
Review src/api/ focusing on performance optimization - identify bottlenecks and optimization opportunities
```

Or more specific:

```bash
Performance-focused review of API endpoints to identify N+1 queries, caching opportunities, and async bottlenecks
```

Or for deep optimization:

```bash
Deep performance analysis of src/api/ - analyze every database query, network call, and async pattern
```

## What Happens

### Setup: Configure Reviewers for Performance Focus

Each reviewer gets performance-specific instructions:

**Claude Code Perspective**:
- Identify design patterns that hurt performance
- Look for blocking operations
- Assess async/await vs callback patterns
- Identify abstraction layers causing overhead

**Codex Perspective**:
- Analyze algorithm complexity (Big O)
- Detect logic that could be optimized
- Identify redundant operations
- Look for unnecessary iterations

**Gemini Perspective (Main Focus)**:
- Find database query performance issues
- Identify caching opportunities
- Analyze memory usage patterns
- Detect scaling issues

**Droid Perspective**:
- Check for resource leaks
- Verify proper cleanup
- Identify monitoring gaps
- Security impact on performance

### Review Execution

```
Performance-Focused Review
    ↓
1. Gemini analyzes performance (primary)
   ├── Database queries (N+1 problems)
   ├── Caching opportunities
   ├── Memory patterns
   └── Scaling concerns
    ↓
2. Codex analyzes algorithms (secondary)
   ├── Algorithm complexity
   ├── Redundant operations
   ├── Loop optimization
   └── Data structure efficiency
    ↓
3. Claude Code analyzes design (tertiary)
   ├── Async/await patterns
   ├── Blocking operations
   ├── Abstraction layers
   └── Connection pooling
    ↓
4. Droid analyzes resources (quaternary)
   ├── Resource leaks
   ├── Cleanup
   ├── Monitoring
   └── Production readiness
    ↓
Master Aggregates Results
    ├── Score by performance impact
    ├── Estimate improvement potential
    ├── Group related optimizations
    └── Prioritize by ROI
```

## Expected Output

### Performance-Focused Review Report

```json
{
  "reviewId": "perf-focus-a7f3e8c1-2025-11-19",
  "timestamp": "2025-11-19T14:32:00Z",
  "mode": "performance-focused",
  "target": {
    "files": [
      "src/api/users.ts",
      "src/api/products.ts",
      "src/api/orders.ts"
    ],
    "scope": "api-endpoints",
    "totalLinesAnalyzed": 530
  },
  "reviewers": [
    {
      "name": "gemini",
      "focus": "performance",
      "status": "completed",
      "duration": "35s",
      "issuesFound": 7,
      "performanceIssuesFound": 7
    },
    {
      "name": "codex",
      "focus": "algorithms",
      "status": "completed",
      "duration": "38s",
      "issuesFound": 3,
      "performanceIssuesFound": 3
    },
    {
      "name": "claude-code",
      "focus": "design-patterns",
      "status": "completed",
      "duration": "32s",
      "issuesFound": 4,
      "performanceIssuesFound": 4
    },
    {
      "name": "droid",
      "focus": "resource-leaks",
      "status": "completed",
      "duration": "30s",
      "issuesFound": 2,
      "performanceIssuesFound": 2
    }
  ],
  "issues": [
    {
      "id": "perf-1",
      "category": "database-queries",
      "severity": "critical",
      "performanceImpact": {
        "type": "response-time",
        "current": "~1200ms",
        "potential": "~80ms",
        "improvement": "93%"
      },
      "location": {
        "file": "src/api/products.ts",
        "line": 45,
        "endpoint": "GET /api/products"
      },
      "title": "N+1 query problem in product listing",
      "description": "For each product in the list (typically 10-50), a separate database query fetches categories. With 50 products, this creates 50 additional queries. With 1000 products, 1000 queries.",
      "codeExample": {
        "before": "for (const product of products) { product.categories = await db.query(`SELECT * FROM categories WHERE productId = ${product.id}`); }",
        "after": "const allCategories = await db.query(`SELECT pc.* FROM product_categories pc WHERE productId IN (${product.ids.join(',')})`); // Single query"
      },
      "detectedBy": ["gemini"],
      "agreementScore": 1.0,
      "suggestedFix": "Use JOIN in single query or batch load with IN clause",
      "priorityScore": 9.8,
      "estimatedFixTime": "15 minutes",
      "estimatedPerformanceGain": "93% faster"
    },
    {
      "id": "perf-2",
      "category": "caching",
      "severity": "high",
      "performanceImpact": {
        "type": "response-time",
        "current": "~600ms",
        "potential": "~50ms",
        "improvement": "92%"
      },
      "location": {
        "file": "src/api/products.ts",
        "line": 12,
        "function": "GET /api/products/:id"
      },
      "title": "Missing caching for product details",
      "description": "Product details endpoint queries database on every request. Same products are requested repeatedly. Should cache for 5-10 minutes.",
      "detectedBy": ["gemini"],
      "agreementScore": 1.0,
      "suggestedFix": "Add Redis cache with 5-minute TTL, invalidate on update",
      "priorityScore": 8.9,
      "estimatedFixTime": "30 minutes",
      "estimatedPerformanceGain": "92% faster (for cache hits)"
    },
    {
      "id": "perf-3",
      "category": "algorithm",
      "severity": "high",
      "performanceImpact": {
        "type": "cpu",
        "complexity": "O(n²) → O(n log n)",
        "improvement": "For 1000 items: 1,000,000 ops → 10,000 ops"
      },
      "location": {
        "file": "src/api/users.ts",
        "line": 87,
        "function": "searchUsers"
      },
      "title": "Inefficient user search with nested loops",
      "description": "Nested loops comparing users with permissions creates O(n²) complexity. With 500 users and 500 roles, this is 250,000 comparisons on every request.",
      "codeExample": {
        "before": "for (const user of users) { for (const role of allRoles) { if (user.roleId === role.id) user.role = role; } }",
        "after": "const roleMap = new Map(allRoles.map(r => [r.id, r])); users.forEach(u => u.role = roleMap.get(u.roleId));"
      },
      "detectedBy": ["codex", "gemini"],
      "agreementScore": 0.5,
      "suggestedFix": "Use Map/Set for O(1) lookup instead of nested loop",
      "priorityScore": 8.1,
      "estimatedFixTime": "10 minutes",
      "estimatedPerformanceGain": "100x faster for large datasets"
    },
    {
      "id": "perf-4",
      "category": "async-patterns",
      "severity": "medium",
      "performanceImpact": {
        "type": "response-time",
        "current": "~800ms (sequential)",
        "potential": "~300ms (parallel)",
        "improvement": "63%"
      },
      "location": {
        "file": "src/api/orders.ts",
        "line": 34,
        "function": "GET /api/orders/:id"
      },
      "title": "Sequential database calls that could run in parallel",
      "description": "Function fetches order, then user, then items sequentially. These are independent and could fetch simultaneously.",
      "codeExample": {
        "before": "const order = await db.query('SELECT...'); const user = await db.query('SELECT...'); const items = await db.query('SELECT...');",
        "after": "const [order, user, items] = await Promise.all([ db.query('SELECT order...'), db.query('SELECT user...'), db.query('SELECT items...') ]);"
      },
      "detectedBy": ["claude-code", "gemini"],
      "agreementScore": 0.5,
      "suggestedFix": "Use Promise.all() to parallelize independent queries",
      "priorityScore": 7.6,
      "estimatedFixTime": "5 minutes",
      "estimatedPerformanceGain": "63% faster"
    },
    {
      "id": "perf-5",
      "category": "database-indexes",
      "severity": "high",
      "performanceImpact": {
        "type": "query-time",
        "current": "~2000ms (full table scan)",
        "potential": "~50ms (with index)",
        "improvement": "98%"
      },
      "location": {
        "file": "src/api/orders.ts",
        "line": 56,
        "query": "SELECT * FROM orders WHERE status = ? AND createdAt > ?"
      },
      "title": "Missing database index on frequently searched columns",
      "description": "Queries filtering by status and createdAt perform full table scans. With millions of orders, this is very slow.",
      "detectedBy": ["gemini"],
      "agreementScore": 1.0,
      "suggestedFix": "Add composite index: CREATE INDEX idx_orders_status_date ON orders(status, createdAt)",
      "priorityScore": 8.7,
      "estimatedFixTime": "5 minutes (zero code changes)",
      "estimatedPerformanceGain": "98% faster queries"
    },
    {
      "id": "perf-6",
      "category": "memory",
      "severity": "medium",
      "performanceImpact": {
        "type": "memory",
        "current": "Growing unbounded",
        "potential": "Stable"
      },
      "location": {
        "file": "src/api/users.ts",
        "line": 120,
        "function": "bulkExport"
      },
      "title": "Memory leak in bulk export - array keeps growing",
      "description": "Cache array stores all exported data without size limit. With 1M+ exports daily, memory grows until server crashes.",
      "codeExample": {
        "before": "if (!cache) cache = []; cache.push(data); // grows forever",
        "after": "const cache = new LRUCache({ max: 1000 }); // bounded size"
      },
      "detectedBy": ["droid", "gemini"],
      "agreementScore": 0.5,
      "suggestedFix": "Use LRU cache or implement periodic cleanup",
      "priorityScore": 7.2,
      "estimatedFixTime": "20 minutes",
      "estimatedPerformanceGain": "Prevents crash, frees memory"
    },
    {
      "id": "perf-7",
      "category": "connection-pooling",
      "severity": "medium",
      "performanceImpact": {
        "type": "response-time",
        "current": "~400ms (new connection overhead)",
        "potential": "~100ms (pooled)",
        "improvement": "75%"
      },
      "location": {
        "file": "src/api/orders.ts",
        "line": 5,
        "module": "database initialization"
      },
      "title": "No connection pooling - creating new database connection per request",
      "description": "Each request creates fresh database connection. Should reuse connections from pool.",
      "detectedBy": ["gemini", "droid"],
      "agreementScore": 0.5,
      "suggestedFix": "Use connection pool (e.g., pg-pool): new Pool({ max: 20 })",
      "priorityScore": 7.8,
      "estimatedFixTime": "20 minutes",
      "estimatedPerformanceGain": "75% faster database access"
    }
  ],
  "optimization_summary": {
    "totalIssuesFound": 7,
    "totalOptimizationOpportunities": 7,
    "criticalIssues": 1,
    "highIssues": 4,
    "mediumIssues": 2,
    "totalEstimatedImprovement": {
      "responseTime": "93% (worst case) → 30-50% (typical improvement)",
      "throughput": "Can handle 10x more requests with same hardware",
      "estimatedMoneyPerDay": "$50-200 (AWS savings from less compute)"
    }
  },
  "performance_metrics": {
    "currentBaseline": {
      "avgResponseTime": "850ms",
      "p99ResponseTime": "2500ms",
      "throughput": "1000 requests/minute",
      "memoryUsage": "Growing (potential leak)"
    },
    "projectedAfterOptimizations": {
      "avgResponseTime": "150-200ms (75% improvement)",
      "p99ResponseTime": "400-500ms (80% improvement)",
      "throughput": "10,000+ requests/minute",
      "memoryUsage": "Stable"
    },
    "estimatedTimeToImplement": "90 minutes total",
    "estimatedROI": "High - every optimization has major impact"
  },
  "implementation_priority": [
    {
      "priority": 1,
      "issueId": "perf-1",
      "title": "Fix N+1 query problem",
      "timeEstimate": "15 min",
      "performanceGain": "93% (most impactful)"
    },
    {
      "priority": 2,
      "issueId": "perf-5",
      "title": "Add database indexes",
      "timeEstimate": "5 min",
      "performanceGain": "98% (easiest/fastest)"
    },
    {
      "priority": 3,
      "issueId": "perf-4",
      "title": "Parallelize async calls",
      "timeEstimate": "5 min",
      "performanceGain": "63%"
    },
    {
      "priority": 4,
      "issueId": "perf-7",
      "title": "Add connection pooling",
      "timeEstimate": "20 min",
      "performanceGain": "75%"
    },
    {
      "priority": 5,
      "issueId": "perf-2",
      "title": "Add caching layer",
      "timeEstimate": "30 min",
      "performanceGain": "92% (for cached requests)"
    },
    {
      "priority": 6,
      "issueId": "perf-3",
      "title": "Fix nested loop algorithm",
      "timeEstimate": "10 min",
      "performanceGain": "100x for large datasets"
    },
    {
      "priority": 7,
      "issueId": "perf-6",
      "title": "Fix memory leak",
      "timeEstimate": "20 min",
      "performanceGain": "Stability/Prevents crash"
    }
  ]
}
```

## Timeline Estimate

| Phase | Duration | What Happens |
|-------|----------|--------------|
| Review Execution | 2-3 min | All 4 reviewers analyze, focused on performance |
| Analysis | 30 sec | Master agent prioritizes by performance impact |
| Report | 30 sec | Display performance-focused findings |
| **Total Review** | **3-4 min** | **Performance analysis complete** |
| **Implementation** | **90 min** | **Fix all 7 issues** |
| **Testing** | **15-20 min** | **Benchmark improvements** |
| **GRAND TOTAL** | **2 hours** | **API 10x faster** |

## Configuration for Performance Review

```bash
# Performance-focused settings
export CODE_REVIEW_MAX_ITERATIONS=1         # Single pass (focus on findings)
export CODE_REVIEW_TIMEOUT=300              # 5 minutes max
export CODE_REVIEW_PARALLEL=true            # Speed up review
export CODE_REVIEW_AUTO_APPLY=false         # Manual for performance changes
export CODE_REVIEW_MIN_AGREEMENT=0.25       # Single AI opinion OK for perf

# Focus only on performance issues
export CODE_REVIEW_FOCUS_AREAS=performance,optimization
export CODE_REVIEW_IGNORE_CATEGORIES=style,documentation,design

# Performance threshold
export CODE_REVIEW_PERFORMANCE_THRESHOLD=10 # Only issues with >10% impact
```

## Understanding Performance Metrics

### Response Time Improvements

```
Current: 850ms average response time
Target: 150-200ms (benchmarks like 200ms = fast)

Gains from each fix:
- N+1 query fix: 850ms → 300ms (65% gain)
- Database indexes: 300ms → 200ms (33% gain)
- Async parallelization: 200ms → 150ms (25% gain)
- Final result: 850ms → 150ms (82% improvement)
```

### Memory Implications

```
Current: Growing unbounded (memory leak)
After LRU cache: ~500MB (stable)
Benefit: Server no longer crashes after 24 hours
```

### Throughput Improvement

```
Current: 1000 requests/minute (bottleneck reached)
With pooling: 2500 req/min
With async parallelization: 5000 req/min
With caching: 10,000+ req/min

Same hardware handles 10x more traffic
```

## Real-World Implementation

### Fix 1: N+1 Query Problem (Priority 1, 15 min)

Before:
```typescript
// src/api/products.ts
app.get('/api/products', async (req, res) => {
  const products = await db.query('SELECT * FROM products');

  // N+1 problem: 1 query + N more queries
  for (const product of products) {
    const categories = await db.query(
      `SELECT * FROM categories WHERE productId = ${product.id}`
    );
    product.categories = categories;
  }

  res.json(products);
});
```

After:
```typescript
// src/api/products.ts
app.get('/api/products', async (req, res) => {
  // Single efficient query
  const products = await db.query(`
    SELECT p.*, json_agg(c.*) as categories
    FROM products p
    LEFT JOIN categories c ON c.productId = p.id
    GROUP BY p.id
  `);

  res.json(products);
});
```

**Impact**: 1200ms → 80ms (93% faster)

### Fix 2: Database Indexes (Priority 2, 5 min)

Before:
```sql
-- No index, full table scan for every query
SELECT * FROM orders WHERE status = 'pending' AND createdAt > '2025-11-01';
```

After:
```sql
-- Add composite index
CREATE INDEX idx_orders_status_date ON orders(status, createdAt);

-- Now uses index (huge speedup)
SELECT * FROM orders WHERE status = 'pending' AND createdAt > '2025-11-01';
```

**Impact**: 2000ms → 50ms (98% faster)

### Fix 3: Parallel Queries (Priority 3, 5 min)

Before:
```typescript
// Sequential: wait for first query, then second, then third
const order = await db.query(`SELECT * FROM orders WHERE id = ${id}`);
const user = await db.query(`SELECT * FROM users WHERE id = ${order.userId}`);
const items = await db.query(`SELECT * FROM items WHERE orderId = ${id}`);

return { order, user, items };
```

After:
```typescript
// Parallel: all three queries run simultaneously
const [order, user, items] = await Promise.all([
  db.query(`SELECT * FROM orders WHERE id = ${id}`),
  db.query(`SELECT * FROM users WHERE id = ?`, [order.userId]),
  db.query(`SELECT * FROM items WHERE orderId = ${id}`)
]);

return { order, user, items };
```

**Impact**: 800ms → 300ms (63% faster)

### Fix 4: Connection Pooling (Priority 4, 20 min)

Before:
```typescript
// New connection per request (overhead)
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL
});

app.get('/api/orders/:id', async (req, res) => {
  await db.connect();
  const result = await db.query(...);
  await db.end(); // Close connection
  res.json(result);
});
```

After:
```typescript
// Connection pool (reuse connections)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20 // Max 20 concurrent connections
});

app.get('/api/orders/:id', async (req, res) => {
  const result = await pool.query(...); // Reuses from pool
  res.json(result);
});
```

**Impact**: 400ms → 100ms (75% faster)

### Fix 5: Add Caching (Priority 5, 30 min)

Before:
```typescript
// Database hit every time
app.get('/api/products/:id', async (req, res) => {
  const product = await db.query(`SELECT * FROM products WHERE id = ${req.params.id}`);
  res.json(product);
});
```

After:
```typescript
import Redis from 'ioredis';
const redis = new Redis();

app.get('/api/products/:id', async (req, res) => {
  // Check cache first
  const cached = await redis.get(`product:${req.params.id}`);
  if (cached) return res.json(JSON.parse(cached));

  // Not in cache, fetch from DB
  const product = await db.query(`SELECT * FROM products WHERE id = ?`, [req.params.id]);

  // Store in cache for 5 minutes
  await redis.setex(`product:${req.params.id}`, 300, JSON.stringify(product));

  res.json(product);
});

// Invalidate cache on update
app.put('/api/products/:id', async (req, res) => {
  const product = await updateProduct(req.params.id, req.body);

  // Clear cache
  await redis.del(`product:${req.params.id}`);

  res.json(product);
});
```

**Impact**: 600ms → 50ms for cache hits (92% faster)

## Performance Testing After Fixes

```bash
# Before optimization
$ npm run test:load
Average response time: 850ms
P99 response time: 2500ms
Throughput: 1000 req/min
Memory: ~1.2GB (growing)

# After optimization
$ npm run test:load
Average response time: 150ms (82% improvement)
P99 response time: 400ms (84% improvement)
Throughput: 10,000+ req/min (10x improvement)
Memory: ~500MB (stable)
```

## Cost Implications

Before optimization:
- Need 10 servers to handle peak load
- Cost: $5000/month

After optimization:
- Can handle peak load on 1 server
- Cost: $500/month
- Savings: $4500/month

Implementing these fixes in 2 hours saves $54,000/year!

## Cost Estimate

For performance-focused review:
- Review cost: $0.40-0.60
- Implementation cost: 2 hours of developer time
- ROI: Massive (10x performance improvement, potential $50K+ savings)

## When This Pattern Works Best

✓ **Perfect for:**
- Slow APIs that need optimization
- High-traffic endpoints bottlenecking
- Memory leaks affecting stability
- Database query optimization
- Caching strategy planning
- Scaling before increased traffic

✗ **Avoid when:**
- Code isn't critical to performance
- Already optimized
- Have other priorities
- Budget very tight

## Checklist After Implementation

- [ ] All 7 fixes implemented
- [ ] Benchmarks show 75-85% improvement
- [ ] Memory usage stable
- [ ] All tests passing
- [ ] Load tests passing
- [ ] Staging environment validated
- [ ] Production deployment
- [ ] Monitor metrics after deployment
- [ ] Document optimization decisions

## Next Steps

1. **Implement** fixes in priority order (biggest gains first)
2. **Benchmark** after each fix
3. **Monitor** production metrics
4. **Document** what you learned
5. **Share** with team

For single-file review, see [single-file-review.md](./single-file-review.md).

For module-wide improvements, see [module-review-iterative.md](./module-review-iterative.md).

For pre-commit validation, see [pre-commit-review.md](./pre-commit-review.md).

---

**Key Insight**: Performance optimization is about identifying bottlenecks and fixing the most impactful ones first. This performance-focused review gives you exactly that roadmap.

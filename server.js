const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const app = express();

app.use(cors());
app.use(express.json());

let blog = {
  title: "My Blog",
  posts: [
    { title: "First Post", date: "2025-06-01", tags: ["intro"], type: "Article", content: "Welcome!", author: "alice", editors: [] }
  ]
};

let users = [
  { name: "alice", role: "admin", password: bcrypt.hashSync("alicepass", 10) },
  { name: "bob", role: "author", password: bcrypt.hashSync("bobpass", 10) },
  { name: "carol", role: "author", password: bcrypt.hashSync("carolpass", 10) }
];

let currentUser = {}; // { sessionId: username }
function getSessionId(req) {
  let sid = req.headers['x-session-id'];
  if (!sid) sid = Math.random().toString(36).slice(2);
  return sid;
}

// Middleware
function requireAuth(req, res, next) {
  const sid = getSessionId(req);
  const username = currentUser[sid];
  if (!username) return res.status(401).json({ error: "Not signed in" });
  req.username = username;
  req.user = users.find(u => u.name === username);
  if (!req.user) return res.status(401).json({ error: "User not found" });
  next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}

// --- API Routes ---

app.get('/api/blog', (req, res) => res.json(blog));
app.get('/api/userinfo', (req, res) => {
  const user = users.find(u => u.name === req.query.name);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ name: user.name, role: user.role });
});
app.get('/api/userhash', (req, res) => {
  const user = users.find(u => u.name === req.query.name);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ hash: user.password });
});
app.get('/api/currentUser', (req, res) => {
  const sid = getSessionId(req);
  res.json({ user: currentUser[sid] || null });
});
app.post('/api/login', (req, res) => {
  // Standard login: client validated password
  const { name } = req.body;
  const user = users.find(u => u.name === name);
  if (!user) return res.status(401).json({ error: "Invalid login" });
  const sid = getSessionId(req);
  currentUser[sid] = name;
  res.json({ success: true, user: { name: user.name, role: user.role } });
});
app.post('/api/logout', (req, res) => {
  const sid = getSessionId(req);
  delete currentUser[sid];
  res.json({ success: true });
});

// --- Admin impersonation ---
app.post('/api/admin/impersonate', requireAuth, requireAdmin, (req, res) => {
  const { target } = req.body;
  const user = users.find(u => u.name === target);
  if (!user) return res.status(404).json({ error: "User not found" });
  const sid = getSessionId(req);
  currentUser[sid] = target;
  res.json({ success: true, user: { name: user.name, role: user.role } });
});

// --- Password change (self or admin for any user) ---
app.post('/api/changePassword', requireAuth, (req, res) => {
  const { newHash, target } = req.body;
  let user;
  if (target && req.user.role === "admin") {
    user = users.find(u => u.name === target);
    if (!user) return res.status(404).json({ error: "User not found" });
    user.password = newHash;
    return res.json({ success: true });
  } else {
    user = users.find(u => u.name === req.username);
    if (!user) return res.status(404).json({ error: "User not found" });
    user.password = newHash;
    return res.json({ success: true });
  }
});

// --- User management (admin) ---
app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { name, role, password } = req.body;
  if (!name || !role || !password) return res.status(400).json({ error: "Missing data" });
  if (users.find(u => u.name === name)) return res.status(400).json({ error: "User already exists" });
  users.push({ name, role, password });
  res.status(201).json({ name, role });
});
app.put('/api/users/:name', requireAuth, requireAdmin, (req, res) => {
  const { name } = req.params;
  const user = users.find(u => u.name === name);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (req.body.role) user.role = req.body.role;
  res.json({ success: true, name: user.name, role: user.role });
});
app.delete('/api/users/:name', requireAuth, requireAdmin, (req, res) => {
  const { name } = req.params;
  const idx = users.findIndex(u => u.name === name);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  users.splice(idx, 1);
  // Remove their posts too?
  blog.posts = blog.posts.filter(post => post.author !== name);
  res.json({ success: true });
});

// --- Post management ---
app.post('/api/posts', requireAuth, (req, res) => {
  let postAuthor = req.username;
  if (req.user.role === "admin" && req.body.asUser) {
    // Admin can post as anyone
    const user = users.find(u => u.name === req.body.asUser);
    if (user) postAuthor = req.body.asUser;
  }
  const post = { ...req.body, author: postAuthor, editors: [] };
  delete post.asUser;
  blog.posts.push(post);
  res.status(201).json(post);
});
app.put('/api/posts/:index', requireAuth, (req, res) => {
  const idx = Number(req.params.index);
  const post = blog.posts[idx];
  if (!post) return res.status(404).json({ error: "Post not found" });
  // Author, editor, or admin
  if (post.author !== req.username && req.user.role !== "admin") return res.status(403).json({ error: "Not allowed" });
  Object.assign(post, req.body);
  post.editors = [...(post.editors || []), req.username];
  res.json(post);
});
app.delete('/api/posts/:index', requireAuth, (req, res) => {
  const idx = Number(req.params.index);
  const post = blog.posts[idx];
  if (!post) return res.status(404).json({ error: "Post not found" });
  if (post.author !== req.username && req.user.role !== "admin") return res.status(403).json({ error: "Not allowed" });
  blog.posts.splice(idx, 1);
  res.json({ success: true });
});

app.use(express.static('public'));
app.listen(3000, () => console.log('Server running on port 3000'));

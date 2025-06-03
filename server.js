const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Store blog posts and users as separate objects
let blog = {
  title: "My Blog",
  posts: [
    {
      title: "First Post",
      date: "2025-06-01",
      tags: ["intro", "welcome"],
      type: "Article",
      content: "Welcome to my first blog post! This is filled from JSON.",
      author: "alice",
      editors: []
    },
    {
      title: "Another Day, Another Post",
      date: "2025-06-02",
      tags: ["daily", "update"],
      type: "Article",
      content: "Here's another entry to my blog, also loaded automatically.",
      author: "bob",
      editors: []
    },
    {
      title: "Tech News",
      date: "2025-06-02",
      tags: ["news", "tech"],
      type: "News",
      content: "Today's tech news is all about AI and robotics.",
      author: "alice",
      editors: []
    },
    {
      title: "JavaScript Tutorial",
      date: "2025-06-01",
      tags: ["tutorial", "javascript"],
      type: "Tutorial",
      content: "Learn JavaScript in this step-by-step tutorial.",
      author: "carol",
      editors: []
    }
  ]
};

let users = [
  { name: "alice", role: "admin" },
  { name: "bob", role: "author" },
  { name: "carol", role: "author" }
];

// Store signed-in user for each session (simple, not for production)
let currentUser = {}; // { sessionId: username }

function getSessionId(req) {
  // Very basic cookie/session handling for demonstration.
  // In production, use express-session or similar.
  let sid = req.headers['x-session-id'];
  if (!sid) {
    sid = Math.random().toString(36).slice(2);
  }
  return sid;
}

// --- API Routes ---

app.get('/api/blog', (req, res) => {
  res.json(blog);
});

app.get('/api/users', (req, res) => {
  res.json(users);
});

app.get('/api/currentUser', (req, res) => {
  const sid = getSessionId(req);
  res.json({ user: currentUser[sid] || null });
});

app.post('/api/currentUser', (req, res) => {
  const sid = getSessionId(req);
  const { user } = req.body;
  currentUser[sid] = user;
  res.json({ success: true, user });
});

app.post('/api/posts', (req, res) => {
  const post = req.body;
  blog.posts.push(post);
  res.status(201).json(post);
});

app.put('/api/posts/:index', (req, res) => {
  const idx = Number(req.params.index);
  if (blog.posts[idx]) {
    blog.posts[idx] = { ...blog.posts[idx], ...req.body };
    res.json(blog.posts[idx]);
  } else {
    res.status(404).json({ error: "Post not found" });
  }
});

app.post('/api/users', (req, res) => {
  users.push(req.body);
  res.status(201).json(req.body);
});

app.put('/api/users/:index', (req, res) => {
  const idx = Number(req.params.index);
  if (users[idx]) {
    users[idx] = { ...users[idx], ...req.body };
    res.json(users[idx]);
  } else {
    res.status(404).json({ error: "User not found" });
  }
});

// Serve static frontend
app.use(express.static('public'));

app.listen(3000, () => console.log('Server running on port 3000'));

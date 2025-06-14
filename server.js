const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const RateLimit = require('express-rate-limit');
const app = express();

app.use(cors());
app.use(express.json());

let blog = {
  title: "My Blog",
  posts: [
    { title: "First Post", date: "2025-06-01", tags: ["intro"], type: "Article", content: "Welcome!", author: "alice", editors: [] }
  ]
};

let users = [{ name: "admin", role: "admin", password: bcrypt.hashSync("0000", 10), passkeys: [], failedAttempts: 0},
            { name: "alice", role: "author", password: bcrypt.hashSync("alice's password", 10), passkeys: [], failedAttempts: 0},
            { name: "bob", role: "suspended", password: bcrypt.hashSync("bob's password", 10), passkeys: [], failedAttempts: 0}];

let currentUser = {}; // { sessionId: username }
function getSessionId(req) {
  let sid = req.headers['x-session-id'];
  if (!sid) sid = crypto.randomBytes(16).toString('hex');
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

app.get('/api/blog', (req, res) => {res.json(blog); console.log("blog accessed");});
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
app.post('/api/login', async (req, res) => {
  const { name, password } = req.body;
  console.log("Login attempted as " + name + ".");
  const user = users.find(u => u.name === name);
  if (!user) return res.status(401).json({ error: "Invalid login" });

  if (user.role == "suspended") return res.status(403).json({ error: "Account suspended" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    user.failedAttempts = (user.failedAttempts || 0) + 1;
    if (user.failedAttempts > 10) {
      user.role = "suspended";
      console.log(name + "'s account was suspended due to too many failed login attempts");
      return res.status(403).json({ error: "Account suspended due to too many failed attempts" });
    }
    return res.status(401).json({ error: "Invalid login" });
    console.log(name + " entered an incorrect password")
  }
  user.failedAttempts = 0; // Reset on successful login
  const sid = getSessionId(req);
  currentUser[sid] = name;
  res.json({ success: true, user: { name: user.name, role: user.role } });
  console.log(name + " logged in successfully");
});
app.post('/api/logout', (req, res) => {
  const sid = getSessionId(req);
  delete currentUser[sid];
  res.json({ success: true });
});

app.post('/api/user/remove-password', requireAuth, (req, res) => {
  if (
    req.user.role === "admin" ||
    (req.user.password && req.user.passkeys && req.user.passkeys.length > 0)
  ) {
    req.user.password = undefined;
    res.json({ success: true });
  } else {
    res.status(403).json({ error: "Not allowed" });
  }
});

// Start passkey registration (must be authenticated)
app.post('/api/passkey/register/options', requireAuth, (req, res) => {
  const name = req.user.name;
  const options = generateRegistrationOptions({
    rpName: "Blog",
    rpID: req.hostname,
    userID: name,
    userName: name,
    attestationType: 'none',
    authenticatorSelection: { userVerification: 'preferred', residentKey: 'required' }
  });
  passkeyChallenge[getSessionId(req)] = { challenge: options.challenge, name };
  res.json(options);
});

// Finish passkey registration
const registerVerifyLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // max 100 requests per windowMs
});

app.post('/api/passkey/register/verify', registerVerifyLimiter, requireAuth, async (req, res) => {
  const { attestationResponse, nickname } = req.body;
  const regData = passkeyChallenge[getSessionId(req)];
  if (!regData) return res.status(400).json({ error: "No registration in progress" });
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge: regData.challenge,
      expectedOrigin: `https://${req.hostname}`,
      expectedRPID: req.hostname,
    });
  } catch (e) {
    return res.status(400).json({ error: "Invalid registration" });
  }
  if (verification.verified) {
    const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
    const user = users.find(u => u.name === regData.name);
    if (!user.passkeys) user.passkeys = [];
    user.passkeys.push({
      credentialID: base64url.encode(credentialID),
      credentialPublicKey: base64url.encode(credentialPublicKey),
      counter,
      nickname: nickname || "Unnamed"
    });
    delete passkeyChallenge[getSessionId(req)];
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Verification failed" });
  }
});

const authOptionsLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // max 100 requests per windowMs
});

app.post('/api/passkey/auth/options', authOptionsLimiter, (req, res) => {
  const { name } = req.body;
  const user = users.find(u => u.name === name && u.passkeys && u.passkeys.length > 0);
  if (!user) return res.status(404).json({ error: "User not found" });
  const options = generateAuthenticationOptions({
    allowCredentials: user.passkeys.map(pk => ({
      id: base64url.toBuffer(pk.credentialID),
      type: 'public-key'
    })),
    userVerification: 'preferred',
    rpID: req.hostname
  });
  passkeyChallenge[getSessionId(req)] = { challenge: options.challenge, name };
  res.json(options);
});

const authVerifyLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // max 100 requests per windowMs
});

app.post('/api/passkey/auth/verify', authVerifyLimiter, async (req, res) => {
  const { name, assertionResponse } = req.body;
  const user = users.find(u => u.name === name && u.passkeys && u.passkeys.length > 0);
  const challengeData = passkeyChallenge[getSessionId(req)];
  if (!user || !challengeData) return res.status(400).json({ error: "Bad request" });

  let matchedPasskey;
  for (const pk of user.passkeys) {
    try {
      let verification = await verifyAuthenticationResponse({
        expectedChallenge: challengeData.challenge,
        expectedOrigin: `https://${req.hostname}`,
        expectedRPID: req.hostname,
        response: assertionResponse,
        authenticator: {
          credentialID: base64url.toBuffer(pk.credentialID),
          credentialPublicKey: base64url.toBuffer(pk.credentialPublicKey),
          counter: pk.counter
        }
      });
      if (verification.verified) {
        pk.counter = verification.authenticationInfo.newCounter;
        matchedPasskey = pk;
        break;
      }
    } catch (e) {}
  }
  if (matchedPasskey) {
    currentUser[getSessionId(req)] = name;
    res.json({ success: true, user: { name, role: user.role } });
  } else {
    res.status(400).json({ error: "Authentication failed" });
  }
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
  console.log("User created. Username is: " + name + ". Role is: " + role + ".");
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

app.use(express.static('.'));

app.get('/', (req, res) => { res.redirect('/index.html'); });

app.listen(3000, () => console.log('Server running on port 3000'));

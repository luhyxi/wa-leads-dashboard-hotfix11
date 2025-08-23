const {
	app,
	BrowserWindow,
	ipcMain,
	Menu,
	dialog,
	shell,
} = require("electron");
const { session } = require("electron");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const MODERN_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const USER_DIR = app.getPath("userData");
const DB_PATH = path.join(USER_DIR, "leads.db");

let db;

function openDb() {
	db = new sqlite3.Database(DB_PATH);
	db.serialize(() => {
		db.run(
			`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`,
		);
		db.run(
			`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT)`,
		);
		db.run(
			`CREATE TABLE IF NOT EXISTS patterns (id TEXT PRIMARY KEY, name TEXT, type TEXT, value TEXT)`,
		);
		db.run(`CREATE TABLE IF NOT EXISTS events (
id INTEGER PRIMARY KEY AUTOINCREMENT,
ts TEXT,
date TEXT,
account_id TEXT,
account_name TEXT,
contact TEXT,
text TEXT,
type TEXT,
pattern_id TEXT,
first_text TEXT
)`);
		db.run(
			`INSERT OR IGNORE INTO config(key,value) VALUES ('reactivateDays','14')`,
		);
	});
}

function getConfig(callback) {
	db.all(`SELECT key,value FROM config`, (err, rows) => {
		if (err) return callback(err);
		const obj = {};
		rows.forEach((r) => (obj[r.key] = r.value));
		obj.reactivateDays = parseInt(obj.reactivateDays || "14", 10);
		callback(null, obj);
	});
}

function setConfig(partial, callback) {
	const entries = Object.entries(partial || {});
	const stmt = db.prepare(
		`INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
	);
	db.serialize(() => {
		entries.forEach(([k, v]) => stmt.run(k, String(v)));
		stmt.finalize((err) => callback(err, true));
	});
}

function listPatterns(callback) {
	db.all(`SELECT * FROM patterns`, callback);
}

function savePatterns(pats, callback) {
	db.serialize(() => {
		db.run(`DELETE FROM patterns`);
		const stmt = db.prepare(
			`INSERT INTO patterns(id,name,type,value) VALUES(?,?,?,?)`,
		);
		(pats || []).forEach((p) =>
			stmt.run(p.id, p.name || "", p.type || "contains", p.value || ""),
		);
		stmt.finalize((err) => callback(err, true));
	});
}

function classifyText(text, callback) {
	db.all(`SELECT * FROM patterns`, (err, rows) => {
		if (err) return callback(null);
		const t = (text || "").toString();
		for (const p of rows || []) {
			try {
				if (p.type === "equals" && t === p.value) return callback(p.id);
				if (p.type === "contains" && t.includes(p.value)) return callback(p.id);
				if (p.type === "startsWith" && t.startsWith(p.value))
					return callback(p.id);
				if (p.type === "regex" && new RegExp(p.value, "i").test(t))
					return callback(p.id);
			} catch (e) {}
		}
		return callback(null);
	});
}

function ensureAccount(accId, name, cb) {
	db.run(
		`INSERT OR IGNORE INTO accounts(id,name) VALUES (?,?)`,
		[accId, name],
		(err) => cb && cb(err),
	);
}

function listAccounts(callback) {
	db.all(`SELECT * FROM accounts ORDER BY name`, callback);
}

function ymdLocal(d) {
	const dt = d ? new Date(d) : new Date();
	const y = dt.getFullYear();
	const m = String(dt.getMonth() + 1).padStart(2, "0");
	const day = String(dt.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function addInboundEvent(payload, callback) {
	getConfig((err, cfg) => {
		const reactivateDays = (cfg && cfg.reactivateDays) || 14;
		const reactivateMs =
			Math.max(0, parseInt(reactivateDays, 10)) * 24 * 3600 * 1000;
		const now = payload.ts ? new Date(payload.ts) : new Date();
		const ts = now.toISOString();
		const date = ymdLocal(now);
		ensureAccount(
			payload.accountId,
			payload.accountName || payload.accountId,
			() => {
				db.get(
					`SELECT ts FROM events WHERE account_id=? AND contact=? ORDER BY id DESC LIMIT 1`,
					[payload.accountId, payload.contact],
					(err2, last) => {
						const lastTs = last ? new Date(last.ts).getTime() : null;
						const isLead = !lastTs || now.getTime() - lastTs > reactivateMs;
						function insert(patternId) {
							const firstText = isLead ? payload.text : null;
							db.run(
								`INSERT INTO events(ts,date,account_id,account_name,contact,text,type,pattern_id,first_text)
VALUES (?,?,?,?,?,?,?,?,?)`,
								[
									ts,
									date,
									payload.accountId,
									payload.accountName || payload.accountId,
									payload.contact,
									payload.text,
									isLead ? "lead" : "inbound",
									isLead ? patternId : null,
									firstText,
								],
								function (err3) {
									if (callback)
										callback(
											err3,
											isLead
												? {
														id: this.lastID,
														ts,
														date,
														accountId: payload.accountId,
														accountName: payload.accountName,
														contact: payload.contact,
														text: payload.text,
														type: "lead",
														patternId,
														firstText,
													}
												: null,
										);
								},
							);
						}
						if (isLead) {
							classifyText(payload.text, (pid) => insert(pid));
						} else {
							insert(null);
						}
					},
				);
			},
		);
	});
}

function getSummary(range, callback) {
	const from = range && range.from ? range.from : null;
	const to = range && range.to ? range.to : null;
	const params = [];
	let where = `WHERE type='lead'`;
	if (from) {
		where += ` AND date>=?`;
		params.push(from);
	}
	if (to) {
		where += ` AND date<=?`;
		params.push(to);
	}
	db.serialize(() => {
		db.get(
			`SELECT COUNT(*) as total FROM events ${where}`,
			params,
			(e1, rowTotal) => {
				db.all(
					`SELECT account_name as name, COUNT(*) as c FROM events ${where} GROUP BY account_name ORDER BY c DESC`,
					params,
					(e2, byAcc) => {
						db.all(
							`SELECT COALESCE(pattern_id,'Sem Padrão') as pid, COUNT(*) as c FROM events ${where} GROUP BY pid ORDER BY c DESC`,
							params,
							(e3, byPat) => {
								db.all(
									`SELECT * FROM events ${where} ORDER BY id DESC LIMIT 200`,
									params,
									(e4, leads) => {
										listAccounts((e5, accounts) => {
											const totalsByAccount = {},
												totalsByPattern = {};
											(byAcc || []).forEach(
												(r) => (totalsByAccount[r.name] = r.c),
											);
											(byPat || []).forEach(
												(r) => (totalsByPattern[r.pid] = r.c),
											);
											callback(null, {
												total: rowTotal ? rowTotal.total : 0,
												totalsByAccount,
												totalsByPattern,
												leads: leads || [],
												accounts: accounts || [],
											});
										});
									},
								);
							},
						);
					},
				);
			},
		);
	});
}

function getDailySeries(range, callback) {
	const from = range && range.from ? range.from : null;
	const to = range && range.to ? range.to : null;
	const params = [];
	let where = `WHERE type='lead'`;
	if (from) {
		where += ` AND date>=?`;
		params.push(from);
	}
	if (to) {
		where += ` AND date<=?`;
		params.push(to);
	}
	db.all(
		`SELECT date, COUNT(*) as c FROM events ${where} GROUP BY date ORDER BY date ASC`,
		params,
		(err, rows) => {
			callback(err, rows || []);
		},
	);
}

function getEvents(limit, callback) {
	db.all(
		`SELECT * FROM events ORDER BY id DESC LIMIT ?`,
		[limit || 200],
		(e, rows) => callback(e, rows || []),
	);
}

function exportCSV(filePath, callback) {
	const header =
		"timestamp,date,account,contact,type,pattern,first_text,text\n";
	fs.writeFileSync(filePath, header, "utf-8");
	const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
	db.all(
		`SELECT ts,date,account_name,contact,type,COALESCE(pattern_id,'') AS pattern, COALESCE(first_text,'') AS first_text, text
FROM events ORDER BY id ASC`,
		[],
		(err, rows) => {
			if (err) {
				if (callback) callback(err);
				return;
			}
			for (const row of rows) {
				const line =
					[
						row.ts,
						row.date,
						row.account_name,
						row.contact,
						row.type,
						row.pattern,
						row.first_text,
						row.text,
					]
						.map(esc)
						.join(",") + "\n";
				fs.appendFileSync(filePath, line, "utf-8");
			}
			if (callback) callback(null, rows.length);
		},
	);
}

let mainWin;

function removeAccount(accId, removeEvents, cb) {
	try {
		const acc = ACCOUNTS.get(accId);
		if (acc && acc.win && !acc.win.isDestroyed()) acc.win.close();
	} catch (e) {}
	const part = `persist:${accId}`;
	try {
		session.fromPartition(part).clearStorageData({});
	} catch (e) {}
	db.serialize(() => {
		db.run(`DELETE FROM accounts WHERE id=?`, [accId]);
		if (removeEvents) db.run(`DELETE FROM events WHERE account_id=?`, [accId]);
		listAccounts((_e, list) => {
			if (mainWin) mainWin.webContents.send("accounts:changed", list || []);
			cb && cb(null, true);
		});
	});
}

const ACCOUNTS = new Map();

function createMain() {
	mainWin = new BrowserWindow({
		width: 1280,
		height: 820,
		title: "WA Leads Dashboard",
		webPreferences: { nodeIntegration: true, contextIsolation: false },
	});
	mainWin.webContents.setUserAgent(MODERN_UA);
	mainWin.loadFile(path.join(__dirname, "index.html"));
	mainWin.on("closed", () => (mainWin = null));
	const menu = Menu.buildFromTemplate([
		{ role: "appMenu" },
		{
			label: "Arquivo",
			submenu: [
				{
					label: "Exportar CSV…",
					click: async () => {
						const { canceled, filePath } = await dialog.showSaveDialog(
							mainWin,
							{
								title: "Exportar CSV",
								defaultPath: `wa-leads-${new Date().toISOString().slice(0, 10)}.csv`,
								filters: [{ name: "CSV", extensions: ["csv"] }],
							},
						);
						if (!canceled && filePath) {
							exportCSV(filePath, () => shell.showItemInFolder(filePath));
						}
					},
				},
				{ type: "separator" },
				process.platform === "darwin" ? { role: "close" } : { role: "quit" },
			],
		},
		{ role: "viewMenu" },
		{ role: "windowMenu" },
	]);
	Menu.setApplicationMenu(menu);
}

function createAccountWindow(name) {
	const id = name.replace(/[^\w-]+/g, "_") + "_" + Date.now().toString(36);
	const win = new BrowserWindow({
		width: 1040,
		height: 800,
		title: `Conta: ${name}`,
		webPreferences: {
			partition: `persist:${id}`,
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: false,
			sandbox: false,
		},
	});
	win.webContents.setUserAgent(MODERN_UA);
	win.loadURL("https://web.whatsapp.com/?waAccount=" + encodeURIComponent(id));
	
	// Enable developer mode automatically when window opens
	win.webContents.once('did-finish-load', () => {
		win.webContents.openDevTools();
	});
	
	win.on("closed", () => {
		ACCOUNTS.delete(id);
		listAccounts(
			(_, list) =>
				mainWin && mainWin.webContents.send("accounts:changed", list || []),
		);
	});
	ACCOUNTS.set(id, { win, name });
	ensureAccount(id, name, () =>
		listAccounts(
			(_, list) =>
				mainWin && mainWin.webContents.send("accounts:changed", list || []),
		),
	);
	return id;
}

ipcMain.handle("app:addAccount", (_e, name) => createAccountWindow(name));
ipcMain.handle(
	"app:listAccounts",
	(_e) => new Promise((res) => listAccounts((_, rows) => res(rows || []))),
);
ipcMain.handle(
	"accounts:delete",
	(_e, accId, removeEvents) =>
		new Promise((res) =>
			removeAccount(accId, !!removeEvents, (_e2) => res(true)),
		),
);
ipcMain.handle(
	"summary:get",
	(_e, range) =>
		new Promise((res) => getSummary(range || {}, (_err, data) => res(data))),
);
ipcMain.handle(
	"series:get",
	(_e, range) =>
		new Promise((res) =>
			getDailySeries(range || {}, (_err, rows) => res(rows)),
		),
);
ipcMain.handle(
	"patterns:get",
	() => new Promise((res) => listPatterns((_e, rows) => res(rows || []))),
);
ipcMain.handle(
	"patterns:set",
	(_e, pats) =>
		new Promise((res) => savePatterns(pats || [], (_e2) => res(true))),
);
ipcMain.handle(
	"config:get",
	() => new Promise((res) => getConfig((_e, c) => res(c))),
);
ipcMain.handle(
	"config:set",
	(_e, cfg) => new Promise((res) => setConfig(cfg || {}, (_e2) => res(true))),
);
ipcMain.handle(
	"events:get",
	(_e, limit) =>
		new Promise((res) =>
			getEvents(limit || 200, (_e2, rows) => res(rows || [])),
		),
);
ipcMain.handle(
	"store:clear",
	() => new Promise((res) => db.run(`DELETE FROM events`, () => res(true))),
);

ipcMain.on("wa:inbound-any", (_e, payload) => {
	try {
		console.log("[WA Leads] Recebido evento", payload);
	} catch (_e1) {}
	const acc = ACCOUNTS.get(payload.accountId);
	const accountName = acc ? acc.name : payload.accountName || payload.accountId;
	const enriched = { ...payload, accountName };
	addInboundEvent(enriched, (_err, leadEvt) => {
		if (mainWin) {
			mainWin.webContents.send("inbound:any", { ...enriched });
			if (leadEvt) mainWin.webContents.send("lead:new", leadEvt);
		}
	});
});

app.whenReady().then(() => {
	openDb();
	createMain();
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createMain();
});

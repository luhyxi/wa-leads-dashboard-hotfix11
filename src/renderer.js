const { ipcRenderer } = require("electron");
let chart,
	chartType = "bar";
const Chart = require("chart.js/auto");
const chartEl = document.getElementById("chart").getContext("2d");

const todayCountEl = document.getElementById("todayCount");
const byAccEl = document.getElementById("byAcc");
const byPatEl = document.getElementById("byPat");
const leadsTbody = document.querySelector("#leads tbody");
const eventsTbody = document.querySelector("#events tbody");
const lastEventEl = document.getElementById("lastEvent");

const accName = document.getElementById("accName");
document.getElementById("addAcc").onclick = async () => {
	const name = (accName.value || "").trim();
	if (!name) return alert("Dê um nome para a conta (ex.: Vendas 01)");
	await ipcRenderer.invoke("app:addAccount", name);
	accName.value = "";
};
document.getElementById("apply").onclick = () => refreshAll();
document.getElementById("typeBar").onclick = () => {
	chartType = "bar";
	refreshChart();
};
document.getElementById("typeLine").onclick = () => {
	chartType = "line";
	refreshChart();
};

document.getElementById("addPattern").onclick = () => addPatternRow();
document.getElementById("savePatterns").onclick = savePatterns;
document.getElementById("saveCfg").onclick = saveConfig;
document.getElementById("clearDb").onclick = async () => {
	await ipcRenderer.invoke("store:clear");
	refreshAll();
	alert("Base zerada.");
};

const fromEl = document.getElementById("from"),
	toEl = document.getElementById("to");
function ymd(d) {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}
function today() {
	return ymd(new Date());
}
function startDefault() {
	const d = new Date();
	d.setDate(d.getDate() - 6);
	return ymd(d);
}

async function loadConfig() {
	const cfg = await ipcRenderer.invoke("config:get");
	document.getElementById("cfgDays").value = cfg.reactivateDays ?? 14;
}
async function saveConfig() {
	const days = Math.max(
		0,
		parseInt(document.getElementById("cfgDays").value || "14", 10),
	);
	await ipcRenderer.invoke("config:set", { reactivateDays: days });
	alert("Configuração salva!");
}

async function loadPatterns() {
	const pats = await ipcRenderer.invoke("patterns:get");
	const box = document.getElementById("patterns");
	box.innerHTML = "";
	pats.forEach((p) => addPatternRow(p));
}
function addPatternRow(p = { id: "", name: "", type: "contains", value: "" }) {
	const box = document.getElementById("patterns");
	const row = document.createElement("div");
	row.className = "pat";
	const id = document.createElement("input");
	id.value = p.id || "";
	id.placeholder = "ID";
	const name = document.createElement("input");
	name.value = p.name || "";
	name.placeholder = "Nome";
	const type = document.createElement("select");
	["equals", "contains", "startsWith", "regex"].forEach((t) => {
		const o = document.createElement("option");
		o.value = t;
		o.textContent = t;
		if (p.type === t) o.selected = true;
		type.appendChild(o);
	});
	const value = document.createElement("input");
	value.value = p.value || "";
	value.placeholder = "Valor";
	const del = document.createElement("button");
	del.textContent = "Excluir";
	del.onclick = () => row.remove();
	[id, name, type, value, del].forEach((x) => row.appendChild(x));
	box.appendChild(row);
}
async function savePatterns() {
	const rows = [...document.querySelectorAll("#patterns .pat")];
	const pats = rows
		.map((r) => {
			const inputs = r.querySelectorAll("input,select");
			return {
				id: inputs[0].value.trim(),
				name: inputs[1].value.trim(),
				type: inputs[2].value,
				value: inputs[3].value.trim(),
			};
		})
		.filter((p) => p.id && p.value);
	await ipcRenderer.invoke("patterns:set", pats);
	alert("Padrões salvos.");
}

async function refreshChart() {
	const range = {
		from: fromEl.value || startDefault(),
		to: toEl.value || today(),
	};
	const points = await ipcRenderer.invoke("series:get", range);
	const labels = points.map(
		(p) => p.date.slice(8, 10) + "/" + p.date.slice(5, 7),
	);
	const values = points.map((p) => p.c);
	if (chart) chart.destroy();
	chart = new Chart(chartEl, {
		type: chartType,
		data: {
			labels,
			datasets: [
				{
					label: "Leads por dia",
					data: values,
					backgroundColor: "#e63946",
					borderColor: "#ff4c4c",
					fill: true,
					tension: 0.25,
				},
			],
		},
		options: {
			responsive: true,
			plugins: { legend: { labels: { color: "#fff" } } },
			scales: {
				x: { ticks: { color: "#fff" } },
				y: { ticks: { color: "#fff" } },
			},
		},
	});
}

async function refreshSummary() {
	const todayStr = today();
	const sToday = await ipcRenderer.invoke("summary:get", {
		from: todayStr,
		to: todayStr,
	});
	todayCountEl.textContent = sToday.total || 0;
	byAccEl.innerHTML = "";
	(sToday.accounts || []).forEach((a) => {
		const li = document.createElement("li");
		li.dataset.acc = a.name;
		li.textContent = `${a.name}: 0`;
		byAccEl.appendChild(li);
	});
	Object.entries(sToday.totalsByAccount || {}).forEach(([name, c]) => {
		const li =
			[...byAccEl.children].find((x) => x.dataset.acc === name) ||
			document.createElement("li");
		li.dataset.acc = name;
		li.textContent = `${name}: ${c}`;
		if (!li.parentNode) byAccEl.appendChild(li);
	});
	byPatEl.innerHTML = "";
	Object.entries(sToday.totalsByPattern || {}).forEach(([pid, c]) => {
		const li = document.createElement("li");
		li.textContent = `${pid}: ${c}`;
		byPatEl.appendChild(li);
	});

	const sAny = await ipcRenderer.invoke("summary:get", {
		from: fromEl.value || startDefault(),
		to: toEl.value || todayStr,
	});
	leadsTbody.innerHTML = "";
	(sAny.leads || []).forEach((l) => {
		const tr = document.createElement("tr");
		const when = new Date(l.ts).toLocaleString();
		tr.innerHTML = `<td>${when}</td><td>${l.account_name || l.accountId}</td><td>${l.contact}</td><td>${l.pattern_id || "—"}</td><td>${l.first_text || l.text || ""}</td>`;
		leadsTbody.appendChild(tr);
	});

	const evs = await ipcRenderer.invoke("events:get", 200);
	eventsTbody.innerHTML = "";
	evs.forEach((e) => {
		const tr = document.createElement("tr");
		tr.innerHTML = `<td>${new Date(e.ts).toLocaleString()}</td><td>${e.account_name || e.accountId}</td><td>${e.contact}</td><td>${e.type || "inbound"}</td><td>${e.first_text || e.text || ""}</td>`;
		eventsTbody.appendChild(tr);
	});
}

async function refreshAll() {
	await refreshSummary();
	await refreshChart();
}

ipcRenderer.on("inbound:any", () => {
	lastEventEl.textContent = "Último evento: " + new Date().toLocaleTimeString();
	refreshAll();
});
ipcRenderer.on("lead:new", () => refreshAll());
ipcRenderer.on("accounts:changed", () => {
	refreshAll();
	refreshAccounts();
});

window.addEventListener("DOMContentLoaded", async () => {
	const d = new Date();
	const t = new Date();
	t.setDate(d.getDate() - 6);
	document.getElementById("from").value = ymd(t);
	document.getElementById("to").value = ymd(d);
	await loadConfig();
	await loadPatterns();
	await refreshAll();
	await refreshAccounts();
});

async function refreshAccounts() {
	const list = await ipcRenderer.invoke("app:listAccounts");
	const box = document.getElementById("accList");
	if (!box) return;
	box.innerHTML = "";
	(list || []).forEach((acc) => {
		const wrap = document.createElement("div");
		wrap.className = "acc-item";
		wrap.innerHTML = `<b>${acc.name}</b><span class="muted">(${acc.id})</span>`;
		const btn1 = document.createElement("button");
		btn1.className = "ghost";
		btn1.textContent = "Remover";
		btn1.onclick = async () => {
			if (!confirm(`Remover a conta "${acc.name}" e limpar sessão?`)) return;
			await ipcRenderer.invoke("accounts:delete", acc.id, false);
			refreshAll();
			refreshAccounts();
		};
		const btn2 = document.createElement("button");
		btn2.textContent = "Remover + eventos";
		btn2.onclick = async () => {
			if (
				!confirm(
					`Remover a conta "${acc.name}" e APAGAR TODOS os eventos dela?`,
				)
			)
				return;
			await ipcRenderer.invoke("accounts:delete", acc.id, true);
			refreshAll();
			refreshAccounts();
		};
		wrap.appendChild(btn1);
		wrap.appendChild(btn2);
		box.appendChild(wrap);
	});
}

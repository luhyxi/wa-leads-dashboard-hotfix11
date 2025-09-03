const { ipcRenderer, contextBridge } = require("electron");

// ---- Painel de debug visual (Shift+Alt+L) ----
(function () {
	let box;
	function toggle() {
		if (box) {
			box.remove();
			box = null;
			return;
		}
		box = document.createElement("div");
		box.id = "__wa_leads_debug";
		box.style.cssText =
			"position:fixed;right:8px;bottom:8px;font:12px monospace;background:rgba(0,0,0,.75);color:#0f0;padding:8px 10px;border:1px solid #0f0;border-radius:8px;z-index:999999";
		box.textContent = "[WA Leads] debug ligado";
		document.body.appendChild(box);
	}
	window.addEventListener("keydown", (e) => {
		if (e.shiftKey && e.altKey && e.code === "KeyL") {
			try {
				toggle();
			} catch (_e) {}
		}
	});
	window.__waLog = (msg, obj) => {
		try {
			console.log(msg, obj || "");
			const el = document.getElementById("__wa_leads_debug");
			if (el)
				el.textContent =
					(typeof msg === "string" ? msg : JSON.stringify(msg)) +
					(obj ? " " + JSON.stringify(obj) : "");
		} catch (_e) {}
	};
})();

// Disponibiliza ponte para teste manual e mantém __waSendTest também
try {
	contextBridge.exposeInMainWorld("__waBridge", {
		sendTest: (text = "TESTE") => {
			const KEY = "__wa_leads_accid";
			const accountId = localStorage.getItem(KEY) || "acc_debug";
			__waLog("[WA Leads] __waBridge.sendTest", { accountId, text });
			ipcRenderer.send("wa:inbound-any", {
				accountId,
				contact: "Contato Teste",
				text,
				ts: new Date().toISOString(),
			});
			return true;
		},
	});
} catch (_e) {}
window.__waSendTest = (text = "TESTE") => {
	try {
		if (window.__waBridge) return window.__waBridge.sendTest(text);
	} catch (_e) {}
	return false;
};

(function initWhatsAppProbe() {
	try {
		if (!location.hostname.includes("whatsapp.com")) return;
		__waLog("[WA Leads] Preload carregado em " + location.href);

		// accountId persistente
		const KEY = "__wa_leads_accid";
		let accountId = localStorage.getItem(KEY);
		if (!accountId) {
			const params = new URLSearchParams(location.search);
			accountId =
				params.get("waAccount") ||
				"acc_" + Math.random().toString(36).slice(2, 8);
			localStorage.setItem(KEY, accountId);
		}

		const TME = 160;
		const txt = (el) =>
			(el && el.innerText ? el.innerText : "").replace(/\s+/g, " ").trim();
		const notMinePre = (el) => {
			const pre = el?.getAttribute?.("data-pre-plain-text") || "";
			return pre && !/Você:|Voce:|You:/i.test(pre);
		};
		const isOutgoing = (s) => /^(Você:|Voce:|You:)/i.test(String(s || ""));

		// --------- CAPTURA NA CONVERSA ABERTA ---------
		let lastOpenText = null;
		function captureOpenChat() {
			try {
				const root =
					document.querySelector(
						'[data-testid="conversation-panel-messages"]',
					) ||
					document.getElementById("main") ||
					document.body;
				if (!root) return;
				let containers = root.querySelectorAll('[data-testid="msg-container"]');
				// Fallback: alguns layouts não possuem [data-testid="msg-container"]. Usa spans genéricos.
				if (!containers || containers.length === 0) {
					__waLog("[WA Leads] CHAT fallback sem msg-container");
					const spans = root.querySelectorAll('._ao3e.selectable-text.copyable-text');
					let lastText = null;
					for (let i = spans.length - 1; i >= 0; i--) {
						const t = (spans[i].innerText || "").trim();
						if (t && !/^(Você:|Voce:|You:)/i.test(t)) {
							lastText = t;
							break;
						}
					}
					if (lastText && lastText !== window.__wa_last_open_text) {
						window.__wa_last_open_text = lastText;
						__waLog("[WA Leads] CHAT Fallback texto", { t: lastText });
						console.log("line 114");
						dispatch(accountId, readHeaderContact(), lastText);
					}
					return; // termina aqui no fallback
				}
				for (let i = containers.length - 1; i >= 0; i--) {
					const c = containers[i];
					// Via atributo pre-plain
					const pre = c.querySelector("[data-pre-plain-text]");
					if (pre && notMinePre(pre)) {
						const t = txt(pre);
						if (t && t !== lastOpenText) {
							lastOpenText = t;
							__waLog("[WA Leads] CHAT pre-plain", { t });
							console.log("line 128");
							dispatch(accountId, readHeaderContact(), t);
							return;
						}
					}
					// Via texto visível
					const tNode = c.querySelector(
						'[data-testid="msg-text"], span[dir="auto"]',
					);
					const t = txt(tNode);
					if (t && !isOutgoing(t) && t !== lastOpenText) {
						lastOpenText = t;
						__waLog("[WA Leads] CHAT texto", { t });
						console.log("line 140");
						dispatch(accountId, readHeaderContact(), t);
						return;
					}
				}
			} catch (e) {
				console.warn("[WA Leads] captureOpenChat erro", e);
			}
		}
		const openObs = new MutationObserver(() => {
			clearTimeout(window.__wa_open_t);
			window.__wa_open_t = setTimeout(captureOpenChat, TME);
		});
		const openBoot = new MutationObserver(() => {
			const pane =
				document.querySelector('[data-testid="conversation-panel-messages"]') ||
				document.getElementById("main") ||
				document.body;
			if (pane) {
				openObs.observe(pane, {
					childList: true,
					subtree: true,
					attributes: true,
				});
				captureOpenChat();
				openBoot.disconnect();
			}
		});
		openBoot.observe(document.documentElement || document, {
			childList: true,
			subtree: true,
		});

		// --------- CAPTURA NA LISTA (INBOX) ---------
		const lastPreviewByContact = new Map();
		function readHeaderContact() {
			try {
				// Find the parent element with data-tab="6"
				const parentElement = document.querySelector('[data-tab="6"]');

				if (!parentElement) {
					console.log("No element with data-tab='6' found");
					return "Contato";
				}

				// Find the first span child within this parent
				const firstSpan = parentElement.querySelector('span');

				if (!firstSpan) {
					console.log("No span found within element with data-tab='6'");
					return "Contato";
				}

				// Get the text content and trim it
				const textContent = firstSpan.textContent?.trim();

				if (!textContent) {
					console.log("First span within data-tab='6' element has no content");
					return "Contato";
				}

				return textContent;

			} catch (error) {
				console.error("Error in readHeaderContact:", error);
				return "Contato";
			}
		}

		function contactFromRow(row) {
			const a = row.querySelector("span[title]");
			if (a) return a.getAttribute("title") || a.textContent || null;
			const b = row.querySelector('[data-testid="cell-frame-title"] span');
			if (b) return (b.getAttribute("title") || b.textContent || "").trim();
			const c = row.querySelector('[role="gridcell"] span[dir="auto"]');
			if (c) return (c.getAttribute("title") || c.textContent || "").trim();
			return null;
		}
		function previewFromRow(row) {
			const aria = row.getAttribute("aria-label");
			if (aria && aria.trim()) return aria.trim();
			const a = row.querySelector('[data-testid="last-msg"]');
			if (a && a.innerText) return a.innerText.trim();
			const b = row.querySelector('div[role="gridcell"] span[dir="auto"]');
			if (b && b.innerText) return b.innerText.trim();
			return null;
		}
		function scanInbox() {
			try {
				const grid =
					document.querySelector('[role="grid"]') ||
					document.querySelector('[data-testid="chatlist"]') ||
					document.querySelector('[data-testid="pane-side"]');
				if (!grid) return;
				const rows = grid.querySelectorAll(
					'[role="row"], [data-testid="cell-frame-container"]',
				);


				rows.forEach((row) => {
					const name = contactFromRow(row);
					const prev = previewFromRow(row);
					if (!name || !prev) return;
					const last = lastPreviewByContact.get(name);
					if (last === prev) return;
					lastPreviewByContact.set(name, prev);
					// linhas de saída
					if (isOutgoing(prev)) return;
					// remove "Nome: " no início, quando presente
					const clean = prev.replace(/^([^:]{1,40}):\s*/, "").trim();
					if (!clean) return;
					__waLog("[WA Leads] INBOX", { name, prev, clean });
					console.log("line 232")
					dispatch(accountId, name, clean);
				});
			} catch (e) {
				console.warn("[WA Leads] scanInbox erro", e);
			}
		}
		const listObs = new MutationObserver(() => {
			clearTimeout(window.__wa_list_t);
			window.__wa_list_t = setTimeout(scanInbox, TME);
		});
		const listBoot = new MutationObserver(() => {
			const grid =
				document.querySelector('[role="grid"]') ||
				document.querySelector('[data-testid="chatlist"]') ||
				document.querySelector('[data-testid="pane-side"]');
			if (grid) {
				listObs.observe(grid, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["aria-label"],
				});
				scanInbox();
				listBoot.disconnect();
			}
		});
		listBoot.observe(document.documentElement || document, {
			childList: true,
			subtree: true,
		});

		setTimeout(() => {
			captureOpenChat();
			scanInbox();
		}, 1500);

		function dispatch(accountId, contact, text) {
			try {
				ipcRenderer.send("wa:inbound-any", {
					accountId,
					contact,
					text,
					ts: new Date().toISOString(),
				});
			} catch (e) {
				console.error("[WA Leads] dispatch erro", e);
			}
		}
	} catch (e) {
		console.error("[WA Leads] Preload fatal", e);
	}
})();

// ====== PROBES/INTERVALS EXTRAS ======
(function extras() {
	// Expor uma função manual para sondar e ver o que o DOM tem agora
	window.__waProbeOnce = () => {
		try {
			const nodes = {
				grid: !!(
					document.querySelector('[role="grid"]') ||
					document.querySelector('[data-testid="chatlist"]') ||
					document.querySelector('[data-testid="pane-side"]') ||
					document.querySelector('[data-testid="chatlist-panel"]')
				),
				row: !!(
					document.querySelector('[role="row"]') ||
					document.querySelector('[data-testid="cell-frame-container"]') ||
					document.querySelector('[role="listitem"]') ||
					document.querySelector("[data-list-item-id]") ||
					document.querySelector('[data-testid^="cell-frame-"]')
				),
				lastMsg: !!document.querySelector('[data-testid="last-msg"]'),
				msgContainer: !!document.querySelector('[data-testid="msg-container"]'),
				msgText: !!(
					document.querySelector('[data-testid="msg-text"]') ||
					document.querySelector('span[dir="auto"]')
				),
				header: !!(
					document.querySelector('[data-testid="conversation-info-header"]') ||
					document.querySelector('header[data-testid="conversation-header"]')
				),
			};
			__waLog("[WA Leads] Probe DOM", nodes);
			// dispara uma varredura imediata
			try {
				if (typeof scanInbox === "function") scanInbox();
			} catch (_e) {}
			try {
				if (typeof captureOpenChat === "function") captureOpenChat();
			} catch (_e) {}
			return nodes;
		} catch (e) {
			console.warn("[WA Leads] __waProbeOnce erro", e);
			return null;
		}
	};

	// Intervalos periódicos para garantir captura mesmo sem mutação
	setInterval(() => {
		try {
			if (typeof scanInbox === "function") scanInbox();
		} catch (_e) {}
		try {
			if (typeof captureOpenChat === "function") captureOpenChat();
		} catch (_e) {}
	}, 2000);
})();

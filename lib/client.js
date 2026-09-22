window.__ModuleLoader__.load({
	id: "dsh-input-limit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/provider.ts
		/** Serialize a failed Remote result into a user-visible line (never localized). */
		function rpcFailure(error) {
			return `${error.message} (${error.code})`;
		}
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function stringOf(value) {
			return typeof value === "string" ? value : void 0;
		}
		function numberAt(value, path) {
			let node = value;
			for (const segment of path) {
				if (!isRecord(node)) return void 0;
				node = node[segment];
			}
			return typeof node === "number" ? node : void 0;
		}
		function arrayAt(value, path) {
			let node = value;
			for (const segment of path) {
				if (!isRecord(node)) return void 0;
				node = node[segment];
			}
			return Array.isArray(node) ? node.filter(isRecord) : void 0;
		}
		/** The namespace whose resolved `providers` dict contains `providerRoute`. */
		function namespaceForRoute(view, providerRoute) {
			return view.namespaces.find((entry) => {
				const providers = isRecord(entry.value) ? entry.value.providers : void 0;
				return isRecord(providers) && providers[providerRoute] !== void 0;
			});
		}
		function modelsOf(namespace, modelsPath) {
			if (namespace === void 0) return [];
			return arrayAt(namespace.value, modelsPath) ?? [];
		}
		/** The current model selection for one session: the durable fold, then the host catalog default. */
		async function currentSelection(deps) {
			const projected = deps.sessions.binding(deps.sessionId)?.session.projections.faceOf("modelSelection");
			const durable = projected?.next ?? projected?.lastUsed ?? null;
			if (durable !== null && durable !== void 0) return durable;
			const catalog = await deps.remote.session.modelCatalog();
			if (!catalog.ok) {
				console.warn("[dsh-input-limit] model catalog unavailable:", catalog.error.message);
				return null;
			}
			return catalog.value.default;
		}
		/**
		* Resolve the session's current model to its configurable provider, read the
		* effective per-model context window, and report its settings address.
		* @param deps - the wire faces and the owning session.
		* @returns the snapshot; `editable: false` means the seat should render nothing.
		*/
		async function readLimit(deps) {
			const current = await currentSelection(deps);
			if (current === null) return deadRead(false, "", "");
			const describe = await deps.remote.settings.describe();
			if (!describe.ok) throw new Error(rpcFailure(describe.error));
			const view = describe.value;
			const namespace = namespaceForRoute(view, current.provider);
			if (namespace === void 0) return deadRead(view.writable, current.provider, current.model);
			const profilePath = ["providers", current.provider];
			const modelsPath = [...profilePath, "models"];
			const entry = modelsOf(namespace, modelsPath).find((row) => stringOf(row.id) === current.model);
			const limit = typeof entry?.contextWindow === "number" ? entry.contextWindow : void 0;
			return {
				editable: true,
				writable: view.writable,
				namespace: namespace.ns,
				profilePath,
				modelsPath,
				provider: current.provider,
				model: current.model,
				limit,
				defaultLimit: numberAt(namespace.value, [...profilePath, "defaultContextWindow"]) ?? numberAt(namespace.base, [...profilePath, "defaultContextWindow"]) ?? numberAt(namespace.user, [...profilePath, "defaultContextWindow"]),
				revision: namespace.revision
			};
		}
		/** A non-editable snapshot (no model, or a provider not present in any settings namespace). */
		function deadRead(writable, provider, model) {
			return {
				editable: false,
				writable,
				namespace: "",
				profilePath: [],
				modelsPath: [],
				provider,
				model,
				limit: void 0,
				defaultLimit: void 0,
				revision: void 0
			};
		}
		/** The `models` array with the target row's `contextWindow` set to `limit` (row replaced, or appended when absent). */
		function withModelLimit(models, model, limit) {
			const index = models.findIndex((row) => stringOf(row.id) === model);
			if (index >= 0) {
				const next = [...models];
				next[index] = {
					...models[index],
					contextWindow: limit
				};
				return next;
			}
			return [...models, {
				id: model,
				contextWindow: limit
			}];
		}
		/** Failure line for a model whose provider has no settings section. */
		const NOT_CONFIGURABLE = "model is not configurable in this deployment";
		/**
		* Persist one write through a fresh describe, retried once when the document
		* moved between the read and the write (`settings/conflict`): both operations
		* are full-array `set`s rebuilt from the fresh view, so replaying them with a
		* fresh revision is safe. An empty op list (nothing to change) succeeds
		* without touching the document.
		*/
		async function persistModels(deps, read, build) {
			let failure = null;
			for (let attempt = 0; attempt < 2; attempt += 1) {
				const describe = await deps.remote.settings.describe();
				if (!describe.ok) return {
					failure: rpcFailure(describe.error),
					limit: void 0
				};
				const namespace = describe.value.namespaces.find((entry) => entry.ns === read.namespace);
				if (namespace === void 0) return {
					failure: "settings namespace not found",
					limit: void 0
				};
				const ops = build(namespace);
				if (ops.length === 0) return {
					failure: null,
					limit: void 0
				};
				const result = await deps.remote.settings.mutate(read.namespace, ops, namespace.revision);
				if (result.ok) return {
					failure: null,
					limit: void 0
				};
				failure = rpcFailure(result.error);
				if (result.error.code !== "settings/conflict") break;
			}
			return {
				failure,
				limit: void 0
			};
		}
		/**
		* Persist a per-model context-window override to the provider's settings
		* section (materializing inherited rows, exactly like the built-in editor).
		* @param deps - the wire faces and the owning session.
		* @param limit - positive token count.
		* @returns the write outcome.
		*/
		async function applyModelLimit(deps, limit) {
			const read = await readLimit(deps);
			if (!read.editable || read.namespace === "") return {
				failure: NOT_CONFIGURABLE,
				limit: void 0
			};
			const outcome = await persistModels(deps, read, (namespace) => [{
				op: "set",
				path: [...read.modelsPath],
				value: withModelLimit(modelsOf(namespace, read.modelsPath), read.model, limit)
			}]);
			return outcome.failure === null ? {
				failure: null,
				limit
			} : outcome;
		}
		/**
		* Remove the current model's context-window override. The user-owned `models`
		* array is rewritten without the field, so the resolved value falls back to
		* the provider route's `defaultContextWindow` (or its inherited base value).
		* @param deps - the wire faces and the owning session.
		* @returns the write outcome.
		*/
		async function resetModelLimit(deps) {
			const read = await readLimit(deps);
			if (!read.editable || read.namespace === "") return {
				failure: NOT_CONFIGURABLE,
				limit: void 0
			};
			return persistModels(deps, read, (namespace) => {
				const userModels = arrayAt(namespace.user, read.modelsPath);
				if (userModels === void 0 || !userModels.some((row) => stringOf(row.id) === read.model)) return [];
				return [{
					op: "set",
					path: [...read.modelsPath],
					value: userModels.map((row) => {
						if (stringOf(row.id) !== read.model) return row;
						const { contextWindow: _dropped, ...rest } = row;
						return rest;
					})
				}];
			});
		}
		//#endregion
		//#region src/client/capacity.ts
		/**
		* Token-capacity parsing/formatting for the input-limit editor. The field
		* speaks ONE unit — exact tokens (`131072`) — and the UI derives the K/M
		* spelling for display, so the stored value and the typed value can never
		* disagree about scale.
		*/
		/** Token-count grouping separator (display only; parsing accepts it back). */
		const GROUP = ",";
		const TOKENS_PATTERN = /^\d+(?:,\d+)*$/;
		/**
		* Read the field text as an exact token count. Blank is its own status (the
		* UI decides what blank means); anything that is not a positive integer —
		* `128K`, `1.5`, `-1`, `0`, stray spaces — is `invalid`, never guessed.
		*
		* Grouping commas are display-only separators and can never change scale, so
		* every digit-run arrangement they can produce parses: the popover pre-fills
		* the grouped spelling (`20,000`) when it reopens, and editing that text —
		* appending a digit (`20,0000`), deleting one (`20,00`), or any non-3-digit
		* cluster (`13,1072`) — must stay valid instead of bouncing the user off.
		* Only comma placement is enforced: leading/trailing/doubled commas are
		* typos, not numbers.
		* @param text - raw field text.
		* @returns the parse outcome.
		*/
		function parseTokens(text) {
			const trimmed = text.trim();
			if (trimmed.length === 0) return { status: "empty" };
			if (!TOKENS_PATTERN.test(trimmed)) return { status: "invalid" };
			const tokens = Number(trimmed.replaceAll(GROUP, ""));
			if (!Number.isSafeInteger(tokens) || tokens <= 0) return { status: "invalid" };
			return {
				status: "ok",
				tokens
			};
		}
		/**
		* Spell an exact token count with digit grouping (`131072` → `131,072`), the
		* form the field itself accepts, so round-tripping a shown value never
		* changes what the user typed.
		* @param value - stored capacity.
		* @returns exact field text.
		*/
		function formatTokens(value) {
			if (!Number.isSafeInteger(value) || value <= 0) return String(value);
			return String(value).replaceAll(/(\d)(?=(\d{3})+$)/g, `$1${GROUP}`);
		}
		/**
		* A compact, display-only spelling of a capacity (`1M`, `128K`, `256K`);
		* counts below 1024 stay exact. Binary scale (K = 1024, M = 1024²) — the
		* convention model context windows are quoted in, so `131072` reads `128K`
		* and pi-ai's `262144` default reads `256K`. Lossy on purpose — labels, not
		* data.
		* @param value - capacity.
		* @returns display text.
		*/
		function formatCompact(value) {
			const K = 1024;
			if (value >= K * K) {
				const scaled = value / (K * K);
				const rounded = Math.round(scaled * 10) / 10;
				return `${String(rounded)}M`;
			}
			if (value >= K) return `${String(Math.round(value / K))}K`;
			return String(value);
		}
		//#endregion
		//#region \0dsh-css:D:\deepseek\dsh-plugin-input-limit\src\client\InputLimitChip.module.css.mjs
		const css = ".THcm5a_wrap{--ilm-border:#dfe1e8;--ilm-bg:#fff;--ilm-bg-hover:#f3f4f8;--ilm-text:#3b3c47;--ilm-text-strong:#1d1e28;--ilm-muted:#8a8b98;--ilm-accent:#3b6ef6;--ilm-accent-text:#fff;--ilm-shadow:0 8px 24px #0f112024;align-items:center;display:inline-flex;position:relative}@media (prefers-color-scheme:dark){.THcm5a_wrap{--ilm-border:#33343f;--ilm-bg:#24252f;--ilm-bg-hover:#2c2d3a;--ilm-text:#d6d7e0;--ilm-text-strong:#ececf4;--ilm-muted:#8a8b99;--ilm-accent:#5b87ff;--ilm-accent-text:#0f1020;--ilm-shadow:0 8px 24px #00000073}}.THcm5a_chip{border:1px solid var(--ilm-border);background:var(--ilm-bg);height:26px;color:var(--ilm-text);font:inherit;white-space:nowrap;cursor:pointer;border-radius:6px;align-items:center;padding:0 9px;font-size:12px;line-height:1;display:inline-flex}.THcm5a_chip:hover{border-color:var(--ilm-muted);background:var(--ilm-bg-hover)}.THcm5a_backdrop{z-index:40;cursor:default;background:0 0;border:0;position:fixed;inset:0}.THcm5a_popover{z-index:50;border:1px solid var(--ilm-border);background:var(--ilm-bg);width:300px;box-shadow:var(--ilm-shadow);color:var(--ilm-text);text-align:left;border-radius:10px;padding:12px 12px 14px;font-size:13px;position:absolute;bottom:calc(100% + 8px);right:0}.THcm5a_popTitle{color:var(--ilm-text-strong);font-size:14px;font-weight:600}.THcm5a_modelName{color:var(--ilm-muted);text-overflow:ellipsis;white-space:nowrap;margin-top:4px;font-size:12px;overflow:hidden}.THcm5a_popHint{color:var(--ilm-muted);margin-top:8px;font-size:12px;line-height:1.5}.THcm5a_fieldLabel{margin-top:10px;display:block}.THcm5a_fieldLabel>span{color:var(--ilm-text);margin-bottom:4px;font-size:12px;display:block}.THcm5a_field{box-sizing:border-box;border:1px solid var(--ilm-border);background:var(--ilm-bg);width:100%;height:32px;color:var(--ilm-text-strong);font:inherit;border-radius:6px;outline:none;padding:0 9px;font-size:13px}.THcm5a_field:focus{border-color:var(--ilm-accent)}.THcm5a_preview{color:var(--ilm-muted);font-variant-numeric:tabular-nums;margin-top:6px;font-size:12px}.THcm5a_error{overflow-wrap:anywhere;color:#d64545;margin-top:8px;font-size:12px;line-height:1.4}.THcm5a_actions{justify-content:flex-end;gap:8px;margin-top:12px;display:flex}.THcm5a_actions button{height:28px;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:6px;padding:0 12px;font-size:12px}.THcm5a_actions button:disabled{cursor:default;opacity:.6}.THcm5a_secondary{background:var(--ilm-bg);color:var(--ilm-text);border-color:var(--ilm-border)!important}.THcm5a_secondary:hover:not(:disabled){background:var(--ilm-bg-hover)}.THcm5a_primary{background:var(--ilm-accent);color:var(--ilm-accent-text)}.THcm5a_primary:hover:not(:disabled){filter:brightness(1.05)}";
		const tagId = "dsh-input-limit/InputLimitChip.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-input-limit";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var InputLimitChip_module_css_default = {
			"modelName": "THcm5a_modelName",
			"preview": "THcm5a_preview",
			"error": "THcm5a_error",
			"actions": "THcm5a_actions",
			"secondary": "THcm5a_secondary",
			"primary": "THcm5a_primary",
			"popHint": "THcm5a_popHint",
			"popTitle": "THcm5a_popTitle",
			"fieldLabel": "THcm5a_fieldLabel",
			"backdrop": "THcm5a_backdrop",
			"wrap": "THcm5a_wrap",
			"field": "THcm5a_field",
			"chip": "THcm5a_chip",
			"popover": "THcm5a_popover"
		};
		//#endregion
		//#region src/client/InputLimitChip.tsx
		/**
		* The composer-seat control: a small chip next to the model picker showing the
		* current model's input limit, opening a popover that writes a per-model
		* `contextWindow` override to the settings document.
		*/
		/** User-visible failure line from an unexpected rejection (never localized). */
		function failureText(reason) {
			return reason instanceof Error ? reason.message : String(reason);
		}
		/**
		* Renders the pill only when a readable limit exists for a configurable
		* provider; a click opens the popover whose save/reset write through the
		* injected wire face.
		*/
		function InputLimitChip({ sessionId, available, read, write, reset, subscribe, t }) {
			const [view, setView] = (0, react.useState)({ status: "idle" });
			const [open, setOpen] = (0, react.useState)(false);
			const [draft, setDraft] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const alive = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				alive.current = true;
				let cancelled = false;
				const load = () => {
					if (!available) return;
					read().then((snapshot) => {
						if (cancelled || !alive.current) return;
						setView(snapshot.editable && snapshot.writable ? {
							status: "ready",
							read: snapshot
						} : { status: "idle" });
					}, (reason) => {
						if (cancelled || !alive.current) return;
						console.warn("[dsh-input-limit] read failed:", reason);
						setView({
							status: "error",
							message: failureText(reason)
						});
					});
				};
				const off = subscribe(load);
				load();
				return () => {
					cancelled = true;
					off();
				};
			}, [
				sessionId,
				available,
				read,
				subscribe
			]);
			if (view.status !== "ready") return null;
			const current = view.read;
			const compact = current.limit !== void 0 ? formatCompact(current.limit) : current.defaultLimit !== void 0 ? formatCompact(current.defaultLimit) : null;
			const isDefault = current.limit === void 0;
			const openPopover = () => {
				setOpen(true);
				setDraft(current.limit !== void 0 ? formatTokens(current.limit) : "");
				setError(null);
			};
			const close = () => {
				setOpen(false);
			};
			const afterCommit = () => {
				setOpen(false);
				setBusy(false);
			};
			const save = () => {
				const parsed = parseTokens(draft);
				if (parsed.status !== "ok") {
					setError(t("error.invalid"));
					return;
				}
				setBusy(true);
				setError(null);
				write(parsed.tokens).then((failure) => {
					if (!alive.current) return;
					if (failure === null) afterCommit();
					else {
						setBusy(false);
						setError(failure);
					}
				}, (reason) => {
					if (!alive.current) return;
					setBusy(false);
					setError(failureText(reason));
				});
			};
			const resetNow = () => {
				setBusy(true);
				setError(null);
				reset().then((failure) => {
					if (!alive.current) return;
					if (failure === null) afterCommit();
					else {
						setBusy(false);
						setError(failure);
					}
				}, (reason) => {
					if (!alive.current) return;
					setBusy(false);
					setError(failureText(reason));
				});
			};
			const label = compact !== null ? `${t("chip.label")} ${compact}${isDefault ? ` · ${t("chip.defaultTag")}` : ""}` : `${t("chip.label")} · ${t("chip.defaultTag")}`;
			const title = current.limit !== void 0 ? `${t("chip.title")} · ${formatTokens(current.limit)} tokens — ${current.model}` : `${t("chip.title")} — ${current.model}`;
			const parsedDraft = parseTokens(draft);
			const preview = parsedDraft.status === "ok" ? formatCompact(parsedDraft.tokens) : null;
			const showPreview = preview !== null && preview !== draft.trim().replaceAll(",", "");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: InputLimitChip_module_css_default.wrap,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: InputLimitChip_module_css_default.chip,
					title,
					"aria-label": `${label}; ${t("chip.ariaAction")}`,
					"aria-expanded": open,
					onClick: () => {
						open ? close() : openPopover();
					},
					children: label
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: InputLimitChip_module_css_default.backdrop,
					"aria-hidden": "true",
					tabIndex: -1,
					onClick: close
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: InputLimitChip_module_css_default.popover,
					role: "dialog",
					"aria-label": t("popover.title"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: InputLimitChip_module_css_default.popTitle,
							children: t("popover.title")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: InputLimitChip_module_css_default.modelName,
							children: current.model
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: InputLimitChip_module_css_default.popHint,
							children: t("popover.hint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: InputLimitChip_module_css_default.fieldLabel,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("field.label") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: InputLimitChip_module_css_default.field,
								autoFocus: true,
								inputMode: "numeric",
								autoComplete: "off",
								spellCheck: false,
								value: draft,
								placeholder: t("field.placeholder"),
								onChange: (event) => {
									setDraft(event.target.value);
									setError(null);
								},
								onKeyDown: (event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										save();
									}
									if (event.key === "Escape") close();
								}
							})]
						}),
						showPreview && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: InputLimitChip_module_css_default.preview,
							children: ["≈ ", preview]
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: InputLimitChip_module_css_default.error,
							role: "alert",
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: InputLimitChip_module_css_default.actions,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: InputLimitChip_module_css_default.secondary,
									onClick: close,
									disabled: busy,
									children: t("cancel")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: InputLimitChip_module_css_default.secondary,
									onClick: resetNow,
									disabled: busy,
									children: t("reset")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: InputLimitChip_module_css_default.primary,
									onClick: save,
									disabled: busy,
									children: busy ? t("saving") : t("save")
								})
							]
						})
					]
				})] })]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Localized copy for the composer input-limit control. Product copy is Chinese;
		* an English dictionary ships alongside for non-zh clients. `en` is typed as a
		* total record over the zh keys, so the two dictionaries cannot drift apart.
		*/
		const zh = {
			"chip.label": "输入上限",
			"chip.defaultTag": "默认",
			"chip.ariaAction": "点击修改当前模型的输入上限",
			"chip.title": "当前模型的输入上限",
			"popover.title": "输入上限",
			"popover.hint": "设置当前模型可消耗的上下文窗口，用于上下文占用与自动压缩判断。输入精确 token 数，下方自动换算 K/M。",
			"field.label": "上下文窗口（tokens）",
			"field.placeholder": "如 131072",
			"save": "保存",
			"saving": "保存中…",
			"reset": "恢复默认",
			"cancel": "取消",
			"error.invalid": "请输入正整数 token 数，如 131072（即 128K）"
		};
		const en = {
			"chip.label": "Input limit",
			"chip.defaultTag": "default",
			"chip.ariaAction": "Set the input limit of the current model",
			"chip.title": "Input limit of the current model",
			"popover.title": "Input limit",
			"popover.hint": "Set the context window this model may consume, used for context pressure and auto-compaction. Type exact tokens; the K/M equivalent appears as you type.",
			"field.label": "Context window (tokens)",
			"field.placeholder": "e.g. 131072",
			"save": "Save",
			"saving": "Saving…",
			"reset": "Reset to default",
			"cancel": "Cancel",
			"error.invalid": "Enter a positive integer token count, e.g. 131072 (= 128K)"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "inputLimit";
		const name = "dsh-input-limit";
		/**
		* Required services: the seat's slot registry, locale, the remote face, the
		* Typert remote sub-namespaces this plugin reads through, and sessions.
		*
		* `remote.settings` / `remote.session` must be listed explicitly — Cordis
		* resolves them through its traceable context proxy (`reflect.props['remote.x']`),
		* so merely injecting `remote` still throws "cannot get property remote.settings
		* without inject" when the faces are accessed below.
		*/
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.session",
			"remote.settings",
			"sessions"
		];
		/**
		* Client plugin body: register the input-limit chip into the composer's right
		* tool-row seat.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "input-limit: dictionaries");
			const rawRemote = ctx.get("remote");
			const sessions = ctx.get("sessions");
			const remote = {
				settings: rawRemote.settings,
				session: rawRemote.session,
				$on: (event, listener) => rawRemote.$on(event, listener)
			};
			const listeners = /* @__PURE__ */ new Set();
			ctx.effect(() => remote.$on("settings/document-updated", () => {
				for (const listener of [...listeners]) listener();
			}), "input-limit: settings refresh");
			ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "input-limit",
				locale: NS,
				inject: (sessionId) => {
					const subagent = sessions.subagentAddress(sessionId) !== void 0;
					const deps = {
						remote,
						sessions,
						sessionId
					};
					return {
						available: !subagent,
						read: () => readLimit(deps),
						write: async (limit) => (await applyModelLimit(deps, limit)).failure,
						reset: async () => (await resetModelLimit(deps)).failure,
						subscribe: (listener) => {
							listeners.add(listener);
							const offProjection = (sessions.binding(sessionId)?.session.projections.faceOf("modelSelection"))?.subscribe?.(() => listener());
							return () => {
								listeners.delete(listener);
								offProjection?.();
							};
						}
					};
				}
			}, InputLimitChip));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
# Model selection

Open Models with F3 or `/model A` and `/model B`. A/B changes roles, Up/Down
chooses a model, Left/Right chooses Low/Medium/High reasoning for A, and Enter
applies the selection. A visible Remember setting controls restart defaults.
The compact overlay preserves the workspace and draft. B lists downloaded,
tool-capable LM Studio models and marks their readiness.

The coordinator owns configuration, the idle gate, session adoption and the
runtime commit. `security/lm-studio.ts` owns inventory, unload/load, readiness,
instance aliases and compensation. The service owns picker/loading/error views.
Only trusted application code can access model management.

Candidate A was selected over B by both the lead and independent cross-judge.
A covers dynamic local choices, reasoning, startup and existing commands. B's
private prepared transaction and explicit unavailable recovery outcome are
retained inside the LM Studio module. A separate lifecycle controller layer
would spread the same policy across additional files, so it is omitted.

Switching unloads the former B model before loading the target. HTTP cancellation
does not prove that LM Studio stopped loading: cancellation waits for an in-flight
mutation to settle, then restores the previous model with a fresh recovery budget.
Registry/defaults commit only after local readiness and runtime construction.
Failed restoration is reported as unavailable rather than successful rollback.
Existing session state and drafts are preserved. Busy workflows must finish or
be cancelled before configuration changes.

The initial sketch has `ModelPickerCatalog`, `ModelChoice`, `PickerReasoning` and
`ModelSwitchProgress` in `src/types/model-selection.ts`. The local host exposes
inventory, readiness, and prepare/commit/rollback; REST payloads remain private.
Contract tests cover phase order, aliases, cancellation, save/runtime failures,
context requirements and role isolation; terminal checks cover both roles,
reasoning, visible controls, progress and draft preservation.

Official metadata checked on 2026-10-18:

- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [API pricing](https://developers.openai.com/api/docs/pricing)
- [LM Studio model inventory](https://lmstudio.ai/docs/developer/rest/list)
- [LM Studio load](https://lmstudio.ai/docs/developer/rest/load)
- [LM Studio unload](https://lmstudio.ai/docs/developer/rest/unload)

The three GPT choices are maintained together in `security/models.ts`. Existing
approved OpenAI descriptors remain usable through explicit commands and saved
configuration. Local model keys come from LM Studio's downloaded inventory;
the inference broker pins one logical key to its verified loaded instance.

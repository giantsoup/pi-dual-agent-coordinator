# Local coding models for Agent B

Researched on 2026-10-18 using model publishers, model conversion repositories, and LM Studio's issue tracker. This note recommends a download and a validation order. It does not claim that any candidate has passed this coordinator's end-to-end coding workflow.

## Recommendation

Download `lmstudio-community/Qwen3.8-27B-MLX-8bit` first. The LM Studio team's Apple silicon conversion is 29.53 GB including repository files. The 8-bit choice fits the machine's capacity with substantially more room for context, the OS, editors, builds, and tests than the largest alternatives. This is a quality-first recommendation based on the current published model evidence and memory fit, pending an actual local Agent B trial. The model is available in LM Studio's catalog as `qwen/qwen3.8-27b`. [LM Studio conversion](https://huggingface.co/lmstudio-community/Qwen3.8-27B-MLX-8bit), [catalog](https://lmstudio.ai/models?dir=desc&sort=downloads)

Qwen3.8-27B is a dense 27B vision-language model with a native 262,144-token context window. It supports non-thinking output. Its publisher reports 61.7 on SWE-bench Pro and 73.0 on Terminal Bench 2.1. These are full model evaluations, not measurements of this MLX conversion in this application. Qwen's SWE-bench Pro evaluation corrects some public tasks and re-evaluates baselines; it cannot establish a clean numerical ranking against older published results from different setups. Its non-thinking defaults are temperature 0.7, top-p 0.80, top-k 20, min-p 0, presence penalty 1.5, and repetition penalty 1.0. [Official model card](https://huggingface.co/Qwen/Qwen3.8-27B)

This coordinator currently disables local reasoning. Its [provider broker](../../src/security/provider-broker.ts) sends `reasoning_effort: "none"`, and its [local model descriptors](../../src/security/models.ts) disable Pi reasoning. Treat the published thinking-model scores as selection evidence, not a promise about reasoning-disabled Agent B performance. Preserve the existing reasoning policy for the initial trial. Verify that LM Studio actually honors it and produces parsed tool calls.

The fallback download is `lmstudio-community/Qwen3-Coder-Next-MLX-6bit`, 64.76 GB. It targets coding agents, activates 3B of its 80B parameters, and supports only non-thinking mode. That makes its operating mode a particularly clean match for a junior engineer implementing Agent A's plan. The publisher recommends temperature 1.0, top-p 0.95, and top-k 40. Use it if the 27B model's dense inference or tool behavior disappoints in the real workflow. Do not assert that it is faster on this Mac without a timed run. [Official model card](https://huggingface.co/Qwen/Qwen3-Coder-Next), [LM Studio 6-bit conversion](https://huggingface.co/lmstudio-community/Qwen3-Coder-Next-MLX-6bit)

## Exact artifacts

Hugging Face API metadata was checked directly on 2026-10-18. Sizes below sum the repository's reported file sizes and use decimal GB. Runtime memory is higher and depends on context, caches, and the backend.

| Artifact | Repository size | Revision observed | Purpose |
| --- | ---: | --- | --- |
| [Qwen3.8-27B MLX 8-bit](https://huggingface.co/lmstudio-community/Qwen3.8-27B-MLX-8bit) | 29,528,178,639 bytes, 29.53 GB | `241ebb5f1d60b122fd653da658836a55feb9e2b0` | First download |
| [Qwen3.8-27B MLX 6-bit](https://huggingface.co/lmstudio-community/Qwen3.8-27B-MLX-6bit) | 22,804,840,143 bytes, 22.80 GB | `05f38c1f39e2f39619653616fe8e96a5d676358e` | Smaller alternative; 8-bit is affordable here |
| [Qwen3-Coder-Next MLX 6-bit](https://huggingface.co/lmstudio-community/Qwen3-Coder-Next-MLX-6bit) | 64,761,564,773 bytes, 64.76 GB | `6b4712e5519c7a7c5612992c5fca1608f42a14c2` | Non-thinking coding specialist |
| [Qwen3-Coder-Next MLX 8-bit](https://huggingface.co/lmstudio-community/Qwen3-Coder-Next-MLX-8bit) | 84,667,207,685 bytes, 84.67 GB | `f911d6c6cb4cf62fd3c5fd4909feb046872e0221` | Higher precision, greater memory pressure |
| [Qwen3.6-35B-A3B MLX 8-bit](https://huggingface.co/lmstudio-community/Qwen3.6-35B-A3B-MLX-8bit) | 37,748,377,462 bytes, 37.75 GB | `ea4ab1544e989b4fa38711453e0296cd7b03ac43` | Efficient older baseline |

Live local inventory inspection found a separate `mlx-community/Qwen3-Coder-Next-8bit` download at approximately 84.67 GB, as well as a smaller Qwen3.6 GGUF. These are different artifacts from identically based LM Studio conversions. A local estimate for the installed Next 8-bit at 65,536 context was 110.39 GiB total, with LOW confidence. That is an estimate, not measured use. It argues against making Next 8-bit the first choice while the Mac also runs development tools.

## Other candidates considered

### Qwen3.6-35B-A3B

This is still a reasonable speed-oriented baseline, especially because it is already downloaded locally. The official model is a 35B MoE with 3B active parameters and supports a non-thinking mode. Its publisher uses an internal bash/file-edit agent for SWE benchmarks and a 200K context window. Comparing those scores directly to Qwen3.8's Claude Code evaluations would overstate what the numbers prove. The publisher's non-thinking sampling settings match the 27B recommendation above. [Official model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B)

### Qwen3.8-Flash-Next

This newer model deserves attention but is an advanced trial on 128 GB. Its architecture has 125B backbone parameters, 6B activated, an additional 51B n-gram embedding, and 4B MTP. Its publisher reports 62.5 SWE-bench Pro versus 61.7 for Qwen3.8-27B, and 58.7 versus 42.2 DeepSWE 1.1. DeepSWE reports the best of two agent frameworks. Its license is Qwen Community 1.0. [Official model card](https://huggingface.co/Qwen/Qwen3.8-Flash-Next)

The Unsloth `UD-Q3_K_XL` main weights total 89,986,353,824 bytes, 89.99 GB, across three GGUF parts. `UD-Q4_K_XL` totals 111,334,654,784 bytes, 111.33 GB, across four parts. These totals exclude the separate vision projector and optional MTP files. Repository revision observed was `766911a6b7369840a91dbcd95f9f997acaab6cd6`. The Q3 option can fit in principle; the Q4 option leaves little working room once loaded. Neither establishes a safe 65K context fit. [Quantizer's repository](https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF/tree/main)

Do not repeat the claim that LM Studio categorically cannot run it. Issue #2345 is closed: the reporter corrected the original GGUF diagnosis and successfully ran it with the 2.31.2 Metal runtime on a 128 GB M4 Max at an 8K context. The maintainer said the MLX runtime was still pending on September 1. Issue #2407 concerns Windows CUDA, not Apple Metal; the user reported that manually updating made it load, with intermittent CUDA errors remaining. These issues support checking the exact backend, not rejecting the model on architecture alone. They do not prove this Mac's installed MLX runtime now supports it. [Corrected Metal report](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2345), [Windows report](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2407)

### GLM

GLM-4.7-Flash is a much smaller, runnable candidate, but it is older and its publisher reports 59.2 SWE-bench Verified. For multi-turn agentic tasks the publisher explicitly recommends preserved thinking. That is a less natural match for the coordinator's present reasoning-disabled policy than Coder Next. An MLX 4-bit conversion is 16.9 GB. [Official model card](https://huggingface.co/zai-org/GLM-4.7-Flash), [MLX artifact](https://huggingface.co/mlx-community/GLM-4.7-Flash-4bit/tree/main)

GLM-5.3-Flash has 320B total parameters and 18B active. Even a theoretical uniform 4-bit representation takes 160 GB before quantization metadata, runtime buffers, and context. More aggressive quantization might squeeze it onto 128 GB, but it is a poor first download for a reliable implementation worker. GLM-5.3 is larger still. [Official Flash model card](https://huggingface.co/zai-org/GLM-5.3-Flash)

### MiniMax

MiniMax-M2.7 reports 56.22 SWE-Pro and 57.0 Terminal Bench 2. Its official deployment recommendations target SGLang, vLLM, Transformers, and related server frameworks. A locally installed 93.64 GB Q3 artifact is worth a later experiment, but its low precision, larger footprint, and reasoning behavior need real validation before replacing a smaller model. Published full model scores do not validate that quantization. [Official M2.7 model card](https://huggingface.co/MiniMaxAI/MiniMax-M2.7)

M2.7 is no longer MiniMax's latest release. M3 is an open-weight native multimodal model with approximately 428B total and 23B active parameters. Its theoretical 4-bit weights alone are about 214 GB, so it is not a sensible 128 GB daily coding recommendation. [Official M3 model card](https://huggingface.co/MiniMaxAI/MiniMax-M3)

### Mistral

Mistral Medium 3.5 is a newer open-weight coding option than Devstral 2. It is dense 128B, supports 256K context, and replaces Devstral 2 in Vibe. At 4-bit it may fit the Mac in principle, but every generated token uses the dense model. Without local timings or a compelling applicable advantage, I would start with the smaller Qwen recommendation. Mistral Small 4 is a 119B MoE with 6.5B active parameters, also viable in quantized form. [Medium 3.5 model card](https://huggingface.co/mistralai/Mistral-Medium-3.5-128B), [Small 4 model card](https://huggingface.co/mistralai/Mistral-Small-4-119B-2603)

Devstral Small 2 remains a compact 24B coding specialist with 256K context and explicit local Mac deployment guidance. It is a useful alternate family for comparison, but no verified evidence here establishes an advantage over Qwen3.8-27B for this coordinator. [Official Devstral Small 2 model card](https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512)

### DeepSeek

The latest DeepSeek Flash release checked was V4.1-Flash, not V3 or the original V4-Flash. Its 552B backbone plus 196B conditional memory is outside a practical 128 GB recommendation at ordinary coding quantizations. It also uses a new encoder-decoder architecture and a custom encoding reference rather than a Jinja chat template. The older V4-Flash is 284B total, which is already 142 GB at theoretical 4-bit precision before overhead. Small active parameter counts do not mean small resident weights. [V4.1 official model card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash), [V4 official model card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash)

## What decides the winner locally

Run the same small Agent A plan on each candidate with the same tool permissions, context, and verification commands. The plan should require reading repository instructions, editing an existing file, invoking the shell, reacting to one failed test, and passing the relevant checks. Inspect the actual final diff and tool-call arguments. Record completion time, peak memory pressure, total retries, unexpected scope changes, and whether the response stream contains genuine parsed tool calls. A fluent chat answer is insufficient for this role.

Start with 65,536 context because this coordinator requires at least that advertised capacity and loads that size. Avoid maxing out a 262K or 1M advertised window before testing the actual workload. Load one model at a time. Keep Agent A responsible for the plan and review, and have Agent B report changed files, commands, results, and blockers. Promote the new download only after its real tool use and resulting code pass that trial.

## Download and connect to Agent B

These directions match the current working checkout, including its downloaded-model picker. An older trusted installation may need updating through the existing [secure setup](../secure-setup.md) before those controls are available. No model download, inference run, runtime update, or configuration change was performed during this research.

1. Open LM Studio. In Discover, search for `Qwen3.8-27B`, select the LM Studio community conversion, and choose **MLX 8-bit**. Confirm the repository is `lmstudio-community/Qwen3.8-27B-MLX-8bit`. The [official catalog entry](https://lmstudio.ai/models/qwen/qwen3.8-27b) also provides an Open in LM Studio link. Allow space beyond the 29.53 GB download for temporary files and normal development work.

   Alternatively, the installed CLI supports downloading the exact Hugging Face repository:

   ```sh
   lms get https://huggingface.co/lmstudio-community/Qwen3.8-27B-MLX-8bit
   lms ls
   ```

   This syntax was checked against the installed `lms get --help`. Official [download documentation](https://lmstudio.ai/docs/cli/local-models/get) explains model storage and format filtering. If `lms` is not on PATH in a new terminal, use `$HOME/.lmstudio/bin/lms`.

2. Use LM Studio's MLX runtime for this artifact. The machine currently has MLX NAX 1.13.1 selected and llama.cpp Metal 2.59.0 selected for GGUF models. These version observations do not prove the new model has loaded. If LM Studio reports an unsupported architecture, update the relevant runtime through its runtime manager and retry.

3. In the model's saved default inference settings, turn **Enable Thinking off**. Use Qwen's non-thinking recipe: temperature `0.7`, top-p `0.80`, top-k `20`, min-p `0`, presence penalty `1.5`, and repetition penalty `1.0`. Keep the supplied model chat template. Save these as defaults for API use and check that API requests actually use them. Qwen's catalog defaults target thinking mode and differ from this recipe. [Publisher settings](https://huggingface.co/Qwen/Qwen3.8-27B), [LM Studio custom thinking control](https://lmstudio.ai/models/qwen/qwen3.8-27b).

4. The local server was already running on port 1234 during inspection. If it is stopped, start it:

   ```sh
   lms server start --port 1234 --bind 127.0.0.1
   ```

   Keep CORS and network serving off. This coordinator expects local requests without LM Studio authentication and uses `http://127.0.0.1:1234/v1`. Keep cloud credentials in the existing Keychain/broker setup. [Server command](https://lmstudio.ai/docs/cli/serve/server-start), [project security model](../security-model.md).

5. In the coordinator, finish or cancel active work. Press **F3**, then **B**, then **R** to refresh. Choose the downloaded Qwen3.8 model. Leave saving enabled, shown in the picker, and press Enter. The current app loads the selected model at **65,536 tokens** and waits for readiness. A disabled model needs valid tool-use and context metadata; do not bypass the check. The actual model key comes from LM Studio's inventory, so use the picker rather than guessing a JSON model ID. [Current project directions](../../README.md).

6. Recheck metadata with the read-only helper:

   ```sh
   python3 docs/research/verify-local-agent-b-models.py
   ```

   It refreshes public artifact sizes and revisions, lists downloaded local LLM capabilities, and reports loaded context lengths. The selected model should be eligible and have a loaded context of at least 65,536. This check proves metadata and readiness claims only. It does not prove working tool calls or code quality.

7. In a disposable project, give Agent A a small implementation task with exact acceptance criteria. Approve its plan and check that B actually reads files, edits the intended file, runs a verification command, and reports its results. Confirm A reviews the real diff. Then compare the same representative repository task against the existing Qwen3.6 model. Keep the new model only if accepted results and total completion time justify it.

For the alternative download, repeat the process with `https://huggingface.co/lmstudio-community/Qwen3-Coder-Next-MLX-6bit`. Its publisher's sampling recipe is temperature `1.0`, top-p `0.95`, top-k `40`; it supports only non-thinking mode. Keep the same 65,536-token context and trial criteria.

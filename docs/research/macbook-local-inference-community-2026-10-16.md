# MacBook local inference community research

Checked online on 16 October 2026. This note records first-hand reports and proposed comparisons. No inference setting, runtime, model, or macOS setting was changed, and no local benchmark was run for this note.

The current thread independently identified an M5 Max MacBook Pro with 40 GPU cores and 128 GB unified memory. Its live LM Studio inventory is 0.4.26+4, with llama.cpp 2.59.0 and MLX 1.13.1 NAX available. Those observations supersede the older inventory in `docs/local-coding-model-research-2026-10-16.md`. Runtime availability does not establish which runtime the current GGUF uses or how fast it is.

## Most relevant first-hand reports

### Matching M5 Max, 128 GB, 40 GPU cores, Qwen3.6 MoE

Reddit user AITA-Critic posted oMLX results for `Qwen3.6-35B-A3B-Uncensored-Heretic-MLX-8bit`. Their single-request table reports 97.3 output tokens/s and 465 ms time to first token with 1,024 input tokens. At 65,536 input tokens it reports 66.3 output tokens/s and 28,991 ms to first token. Reported peak model memory rises from 35.40 GB to 41.85 GB. At 200,000 input tokens, first-token delay reaches about 237 seconds. [Original report and raw table](https://www.reddit.com/r/oMLX/comments/1tqzao9/benchmark_scores_macbook_pro_m5_max_128_gb_ram_40/).

This is an unusually close hardware match and supports testing MLX. It is a modified model, different quantization and server, with only 128 output tokens per test. It does not measure coding correctness or accepted patches. The author's AI-written interpretation overstates multitasking evidence, so use the raw single-request table. Its longer prompts actually contain more tokens. It does not prove that reserving a 64K maximum context slows a 1K request by the same amount.

### Matching M5 Max, recent GGUF and alternative-engine measurements

In a recent discussion, user wegster reports local M5 Max 128 GB measurements of Qwen3.6-35B-A3B `UD-Q4_K_M`. llama.cpp b9870 achieved 1,012 input tokens/s and 62.5 output tokens/s. Splash with DFlash2 produced two results of 1,863/123.8 and 2,107/147.1 input/output tokens/s. The MTP GGUF through that llama.cpp build produced 979/62.2. [Original discussion and measurement comment](https://www.reddit.com/r/LocalLLM/comments/1x5mr90/can_anyone_give_me_your_realistic_speeds_and/).

The commenter explicitly says the workloads, prompt lengths, quants, and settings differ. These are leads for later experiments, not measured speedups over this user's LM Studio setup. The Q4_K_M artifact also differs from the user's existing UD-Q4_K_S. No completed coding task or quality comparison accompanies these numbers. The speculative-decoding figures require a compatible runtime and draft setup. LM Studio 0.4.25 added Splash support, so the current 0.4.26 does not require a Bionic-only app switch; the required draft/model setup still needs checking. [LM Studio's current changelog](https://lmstudio.ai/changelog/lmstudio).

### Real coding-agent replay on an M2 Max, with cache and MTP comparisons

User ghisguth tested Qwen3.6-35B-A3B-MTP `UD-Q4_K_XL` through llama.cpp and Qwen Code on an M2 Max with 64 GB. They report about 60-70 output tokens/s at short context and 35 at about 128K. They captured a real coding session and built a replay covering about 124K context. In that environment, f16 KV cache was faster than compressed cache. A dense Qwen3.6-27B real task took 1:23:17 with f16 versus 2:51:01 with q8_0. That exact duration comparison is for the dense model. [Original test report](https://www.reddit.com/r/LocalLLM/comments/1vbe06e/long_context_testing_on_macbook_pro_max_m2_64gb/).

The same author reports an MTP coding task taking roughly 35 minutes versus 43 without MTP, including build/test time. Their subsequent MTPLX replay generated slightly faster but completed more slowly than llama.cpp. They also discovered that the alternative server processed a different number of input tokens, so this was not a controlled same-input comparison. These findings make completed-task time, prompt reuse, and tool correctness better acceptance criteria than output tokens/s alone. [Author's expanded account](https://ghisguth.github.io/local-llama-macbook-pro-max-m2-64gb/).

This is the strongest coding-workload evidence found. Its older chip, tighter memory budget, different artifact and runtime versions prevent direct predictions for the M5 Max. The author's statement that every compressed cache is slower should remain scoped to their measurements. Their GPU-memory-limit adjustment addressed fitting multiple models on 64 GB and is not a reason to change the memory limit on this 128 GB machine.

### Reproducible OpenCode work on an M1 Pro

Marco Farias's repository supplies HTTP timing scripts and a 12-turn growing-conversation replay on an M1 Pro with 32 GB. For Qwen3.6-35B-A3B Q4_K_S and llama.cpp b9466 it reports about 87% cross-turn prefix reuse, 25.4 output tokens/s, and 10/10 clean multi-tool episodes. It also documents very large differences between cold and cached first-token latency. [Original repository and scripts](https://github.com/marcofariasmx/local-llm-apple-silicon).

Its useful contribution is a rerunnable method and the importance of stable prompt prefixes. Its MTP-cache warning is specific to its recorded stack and conflicts with later positive MTP coding reports. Do not promote it to a current universal limitation. Its quantized-cache settings address a 32 GB machine with swap pressure and should not be copied to a 128 GB machine merely for speed.

## Recommended order of experiments

1. Establish one representative coding-task baseline using the current GGUF and settings. Record first-token delay, input-processing throughput, output throughput, total time to an accepted patch, tool-call failures, memory pressure, and swap. Repeat both cold and warm turns. This follows the replay approach above rather than comparing unrelated chat prompts.
2. Check whether consecutive coding turns reuse the existing prompt. Keep the template and preceding messages stable where the client permits it. An apparent generation slowdown may actually be repeated prompt processing. Investigate observable cache misses before changing multiple sliders.
3. Compare 32K and 64K maximum context only on tasks that fit both, with identical actual inputs. Reducing the configured limit is a memory/working-buffer experiment. Keeping actual coding histories shorter is a separate latency experiment. Neither justifies silently cutting off needed code or tool results.
4. Keep K/V cache quantization at its present default as the first baseline. With 128 GB and current zero swap, the community evidence gives no reason to assume cache compression will be faster. Try q8 only if memory becomes a measured constraint and verify both latency and correctness.
5. Later compare an unmodified Qwen3.6 MLX 4-bit artifact against the existing GGUF on the same accepted-task test. Matching-hardware reports make this worth trying. They do not establish that MLX always beats llama.cpp, especially when prompt reuse and tool handling differ.
6. Treat speculative decoding or MTP as a later separate experiment requiring compatible weights/runtime. Measure warm multi-turn completion time, not just short generated text. First-hand reports contain both improvements and regressions.

These reports do not establish an optimal CPU thread count, evaluation batch size, physical batch size, checkpoint count, or concurrency setting for this exact installed runtime. Do not claim that four configured prediction slots divide a lone request's speed by four. Test actual concurrent requests separately from changing the configured maximum. Keep the model's routed-expert count at its trained value; lowering it is a model-behavior change, not an equivalent speed optimization.

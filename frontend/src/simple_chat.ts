import appConfig from "./app-config";
import * as webllm from "@mlc-ai/web-llm";

function getElementAndCheck(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element == null) {
    throw Error("Cannot find element " + id);
  }
  return element;
}

async function fetchContext(
  query: string,
  systemChat?: string[],
): Promise<string> {
  try {
    const response = await fetch(
      `http://localhost:3000/retrieve?q=${encodeURIComponent(query)}`,
    );
    const data = await response.json();
    const systemContext = systemChat ? `${systemChat.join("\n")}\n` : "";

    if (!data.results || data.results.length === 0) {
      return `${systemContext}No additional context available.`;
    }

    return `${systemContext}${data.results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => item.payload?.text || "No text available")
      .join("\n")}`;
  } catch (error) {
    console.error("Error fetching context:", error);
    return "No additional context available due to an error.";
  }
}

class ChatUI {
  private uiChat: HTMLElement;
  private uiChatInput: HTMLInputElement;
  private uiChatInfoLabel: HTMLLabelElement;
  private engine: webllm.MLCEngineInterface | webllm.WebWorkerMLCEngine;
  private config: webllm.AppConfig = appConfig;
  // private selectedModel = "Mistral-7B-Instruct-v0.3-q4f16_1-MLC";
  private selectedModel = "Llama-3.1-8B-Instruct-q4f32_1-MLC";
  private chatLoaded = false;
  private requestInProgress = false;
  private chatHistory: webllm.ChatCompletionMessageParam[] = [];
  // We use a request chain to ensure that
  // all requests send to chat are sequentialized
  private chatRequestChain: Promise<void> = Promise.resolve();

  private systemChat: string[] = [
    "You are a helpful, respectful and honest assistant.",
    `Today's date and time is ${new Date().toISOString()}.`,
  ];

  /**
   * An asynchronous factory constructor since we need to await getMaxStorageBufferBindingSize();
   * this is not allowed in a constructor (which cannot be asynchronous).
   */
  public static CreateAsync = async (engine: webllm.MLCEngineInterface) => {
    const chatUI = new ChatUI();
    chatUI.engine = engine;
    // get the elements
    chatUI.uiChat = getElementAndCheck("chatui-chat");
    chatUI.uiChatInput = getElementAndCheck("chatui-input") as HTMLInputElement;
    chatUI.uiChatInfoLabel = getElementAndCheck(
      "chatui-info-label",
    ) as HTMLLabelElement;
    // register event handlers
    getElementAndCheck("chatui-reset-btn").onclick = () => {
      chatUI.onReset();
    };
    getElementAndCheck("chatui-send-btn").onclick = () => {
      chatUI.onGenerate();
    };
    // TODO: find other alternative triggers
    getElementAndCheck("chatui-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        chatUI.onGenerate();
      } else if (event.key === "ArrowUp") {
        const lastMessage = chatUI.chatHistory
          .slice()
          .reverse()
          .find((message) => message.role === "user");

        if (lastMessage && event.target) {
          const inputElement = event.target as HTMLInputElement;

          inputElement.value = lastMessage.content as string;

          // Set the caret at the end of the input value
          requestAnimationFrame(() => {
            inputElement.setSelectionRange(
              inputElement.value.length,
              inputElement.value.length,
            );
          });
        }
      }
    });

    // When we detect low maxStorageBufferBindingSize, we assume that the device (e.g. an Android
    // phone) can only handle small models and make all other models unselectable. Otherwise, the
    // browser may crash. See https://github.com/mlc-ai/web-llm/issues/209.
    // Also use GPU vendor to decide whether it is a mobile device (hence with limited resources).
    const androidMaxStorageBufferBindingSize = 1 << 27; // 128MB
    const mobileVendors = new Set<string>(["qualcomm", "arm"]);
    let restrictModels = false;
    let maxStorageBufferBindingSize: number;
    let gpuVendor: string;
    try {
      [maxStorageBufferBindingSize, gpuVendor] = await Promise.all([
        engine.getMaxStorageBufferBindingSize(),
        engine.getGPUVendor(),
      ]);
    } catch (err) {
      chatUI.appendMessage("error", "Init error, " + err.toString());
      console.log(err.stack);
      return;
    }
    if (
      (gpuVendor.length != 0 && mobileVendors.has(gpuVendor)) ||
      maxStorageBufferBindingSize <= androidMaxStorageBufferBindingSize
    ) {
      chatUI.appendMessage(
        "init",
        "Your device seems to have " +
          "limited resources, so we restrict the selectable models.",
      );
      restrictModels = true;
    }

    // Populate modelSelector
    const modelSelector = getElementAndCheck(
      "chatui-select",
    ) as HTMLSelectElement;
    for (let i = 0; i < chatUI.config.model_list.length; ++i) {
      const item = chatUI.config.model_list[i];
      const opt = document.createElement("option");
      opt.value = item.model_id;
      opt.innerHTML = item.model_id;
      opt.selected = chatUI.selectedModel
        ? chatUI.selectedModel === item.model_id
        : i == 0;
      if (
        (restrictModels &&
          (item.low_resource_required === undefined ||
            !item.low_resource_required)) ||
        (item.buffer_size_required_bytes &&
          maxStorageBufferBindingSize < item.buffer_size_required_bytes)
      ) {
        // Either on a low-resource device and not a low-resource model
        // Or device's maxStorageBufferBindingSize does not satisfy the model's need (if specified)
        const params = new URLSearchParams(location.search);
        opt.disabled = !params.has("bypassRestrictions");
        opt.selected = false;
      }
      if (
        !modelSelector.lastChild?.textContent?.startsWith(
          opt.value.split("-")[0],
        )
      ) {
        modelSelector.appendChild(document.createElement("hr"));
      }
      modelSelector.appendChild(opt);
    }
    modelSelector.appendChild(document.createElement("hr"));

    chatUI.selectedModel = modelSelector.value;
    modelSelector.onchange = () => {
      chatUI.onSelectChange(modelSelector);
    };

    chatUI.asyncInitChat();

    return chatUI;
  };

  /**
   * Push a task to the execution queue.
   *
   * @param task The task to be executed;
   */
  private pushTask(task: () => Promise<void>) {
    const lastEvent = this.chatRequestChain;
    this.chatRequestChain = lastEvent.then(task);
  }
  // Event handlers
  // all event handler pushes the tasks to a queue
  // that get executed sequentially
  // the tasks previous tasks, which causes them to early stop
  // can be interrupted by engine.interruptGenerate
  private async onGenerate() {
    if (this.requestInProgress) {
      return;
    }
    this.pushTask(async () => {
      await this.asyncGenerate();
    });
  }

  private async onSelectChange(modelSelector: HTMLSelectElement) {
    if (this.requestInProgress) {
      // interrupt previous generation if any
      this.engine.interruptGenerate();
    }
    // try reset after previous requests finishes
    this.pushTask(async () => {
      await this.engine.resetChat();
      this.resetChatHistory();
      await this.unloadChat();
      this.selectedModel = modelSelector.value;
      await this.asyncInitChat();
    });
  }

  private async onReset() {
    if (this.requestInProgress) {
      // interrupt previous generation if any
      this.engine.interruptGenerate();
    }
    // try reset after previous requests finishes
    this.pushTask(async () => {
      await this.engine.resetChat();
      this.resetChatHistory();
    });
  }

  // Internal helper functions
  private appendMessage(kind, text) {
    if (kind == "init") {
      text = "[System Initalize] " + text;
    }
    if (this.uiChat === undefined) {
      throw Error("cannot find ui chat");
    }
    const msg = `
      <div class="msg ${kind}-msg">
        <div class="msg-bubble">
          <div class="msg-text">${text}</div>
        </div>
      </div>
    `;
    this.uiChat.insertAdjacentHTML("beforeend", msg);
    this.uiChat.scrollTo(0, this.uiChat.scrollHeight);
  }

  // Special care for user input such that we treat it as pure text instead of html
  private appendUserMessage(text: string) {
    if (this.uiChat === undefined) {
      throw Error("cannot find ui chat");
    }
    const msg = `
      <div class="msg right-msg">
        <div class="msg-bubble">
          <div class="msg-text"></div>
        </div>
      </div>
    `;
    this.uiChat.insertAdjacentHTML("beforeend", msg);
    // Recurse three times to get `msg-text`
    const msgElement = this.uiChat.lastElementChild?.lastElementChild
      ?.lastElementChild as HTMLElement;
    msgElement.insertAdjacentText("beforeend", text);
    this.uiChat.scrollTo(0, this.uiChat.scrollHeight);
  }

  private updateLastMessage(kind, text) {
    if (kind == "init") {
      text = "[System Initialize] " + text;
    }
    if (this.uiChat === undefined) {
      throw Error("cannot find ui chat");
    }
    const matches = this.uiChat.getElementsByClassName(`msg ${kind}-msg`);
    if (matches.length == 0) throw Error(`${kind} message do not exist`);
    const msg = matches[matches.length - 1];
    const msgText = msg.getElementsByClassName("msg-text");
    if (msgText.length != 1) throw Error("Expect msg-text");
    if (msgText[0].innerHTML == text) return;
    const list = text.split("\n").map((t) => {
      const item = document.createElement("div");
      item.textContent = t;
      return item;
    });
    msgText[0].innerHTML = "";
    list.forEach((item) => msgText[0].append(item));
    this.uiChat.scrollTo(0, this.uiChat.scrollHeight);
  }

  private resetChatHistory() {
    this.chatHistory = [];
    const clearTags = ["left", "right", "init", "error"];
    for (const tag of clearTags) {
      // need to unpack to list so the iterator don't get affected by mutation
      const matches = [...this.uiChat.getElementsByClassName(`msg ${tag}-msg`)];
      for (const item of matches) {
        this.uiChat.removeChild(item);
      }
    }
    if (this.uiChatInfoLabel !== undefined) {
      this.uiChatInfoLabel.innerHTML = "";
    }
  }

  private async asyncInitChat() {
    if (this.chatLoaded) return;
    this.requestInProgress = true;
    this.appendMessage("init", "");
    const initProgressCallback = (report) => {
      this.updateLastMessage("init", report.text);
    };
    this.engine.setInitProgressCallback(initProgressCallback);

    try {
      await this.engine.reload(this.selectedModel);
    } catch (err) {
      this.appendMessage("error", "Init error, " + err.toString());
      console.log(err.stack);
      this.unloadChat();
      this.requestInProgress = false;
      return;
    }
    this.requestInProgress = false;
    this.chatLoaded = true;
  }

  private async unloadChat() {
    await this.engine.unload();
    this.chatLoaded = false;
  }

  /**
   * Run generate
   */
  private async asyncGenerate() {
    await this.asyncInitChat();
    this.requestInProgress = true;
    const prompt = this.uiChatInput.value;
    if (prompt == "") {
      this.requestInProgress = false;
      return;
    }

    const startTime = performance.now();
    const stats = {
      "Prompt Tokens": 0,
      "Completion Tokens": 0,
      "Total Tokens": 0,
      "Prefill Speed": "",
      "Decoding Speed": "",
      // performance.now() items
      "Time To First Prompt": {
        ms: 0,
        sec: 0,
      },
      "Total Time": {
        ms: 0,
        sec: 0,
      },
    };

    this.appendUserMessage(prompt);
    this.uiChatInput.value = "";
    this.uiChatInput.setAttribute("placeholder", "Generating...");

    this.appendMessage("left", "");
    this.chatHistory.push({ role: "user", content: prompt });

    try {
      let curMessage = "";
      let usage: webllm.CompletionUsage | undefined = undefined;
      const context = await fetchContext(prompt, this.systemChat);
      const completion = await this.engine.chat.completions.create({
        stream: true,
        messages: [{ role: "system", content: context }, ...this.chatHistory],
        stream_options: { include_usage: true },
        temperature: 0,
        top_p: 0.1,
        seed: 42,
      });
      let hasResponse = false;

      // TODO(Charlie): Processing of � requires changes
      for await (const chunk of completion) {
        if (!hasResponse) {
          const timeToFirstResponse = performance.now();

          stats["Time To First Prompt"].ms = timeToFirstResponse - startTime;
          stats["Time To First Prompt"].sec =
            (timeToFirstResponse - startTime) / 1000;

          hasResponse = true;
        }

        const curDelta = chunk.choices[0]?.delta.content;
        if (curDelta) {
          curMessage += curDelta;
        }
        this.updateLastMessage("left", curMessage);
        if (chunk.usage) {
          usage = chunk.usage;
        }
      }
      if (usage) {
        stats["Prompt Tokens"] = usage.prompt_tokens;
        stats["Completion Tokens"] = usage.completion_tokens;
        stats["Total Tokens"] = usage.total_tokens;
        stats["Prefill Speed"] =
          `${usage.extra.prefill_tokens_per_s.toFixed(4)} tokens/sec`;
        stats["Decoding Speed"] =
          `${usage.extra.decode_tokens_per_s.toFixed(4)} tokens/sec`;
      }
      const finalMessage = await this.engine.getMessage();
      this.updateLastMessage("left", finalMessage); // TODO: Remove this after � issue is fixed
      this.chatHistory.push({ role: "assistant", content: finalMessage });
    } catch (err) {
      this.appendMessage("error", "Generate error, " + err.toString());
      console.log(err.stack);
      await this.unloadChat();
    }

    const timeToTotalResponse = performance.now();

    stats["Total Time"].ms = timeToTotalResponse - startTime;
    stats["Total Time"].sec = (timeToTotalResponse - startTime) / 1000;

    this.uiChatInfoLabel.innerHTML = JSON.stringify(stats, null, 2);

    this.uiChatInput.setAttribute("placeholder", "Enter your message...");
    this.requestInProgress = false;
  }
}

const useWebWorker = appConfig.use_web_worker;
let engine: webllm.MLCEngineInterface;

// Here we do not use `CreateMLCEngine()` but instantiate an engine that is not loaded with model
if (useWebWorker) {
  engine = new webllm.WebWorkerMLCEngine(
    new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    { appConfig, logLevel: "INFO" },
  );
} else {
  engine = new webllm.MLCEngine({ appConfig });
}
ChatUI.CreateAsync(engine);

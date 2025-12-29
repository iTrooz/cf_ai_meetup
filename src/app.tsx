/** biome-ignore-all lint/correctness/useUniqueElementIds: it's alright */
import { useEffect, useState, useRef, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "agents/ai-react";
import type { UIMessage } from "@ai-sdk/react";

// Component imports
import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { Avatar } from "@/components/avatar/Avatar";
import { Textarea } from "@/components/textarea/Textarea";
import { MemoizedMarkdown } from "@/components/memoized-markdown";

// Icon imports
import {
  MoonIcon,
  RobotIcon,
  SunIcon,
  TrashIcon,
  PaperPlaneTiltIcon,
  StopIcon
} from "@phosphor-icons/react";

function getProfileID(): string {
  let id = localStorage.getItem("profileID");
  if (!id) {
    id = Math.random().toString(36).slice(2, 7);
    localStorage.setItem("profileID", id);
  }
  return id;
}

export default function Chat() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    // Check localStorage first, default to dark if not found
    const savedTheme = localStorage.getItem("theme");
    return (savedTheme as "dark" | "light") || "dark";
  });
  const [textareaHeight, setTextareaHeight] = useState("auto");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    // Apply theme class on mount and when theme changes
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }

    // Save theme preference to localStorage
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Scroll to bottom on mount
  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
  };

  const [syncedState, setSyncedState] = useState<State>({ state: "introduction" });
  const agent = useAgent({
    agent: "chat",
    name: getProfileID(),
    onStateUpdate: (newState) => {
      setSyncedState(newState as any);
    }
  });

  let indicator: string = "";
  const isWaitingForPartner = syncedState.state === "waiting_for_partner";
  if (isWaitingForPartner) {
    indicator = "Waiting for a community member to join the chat... this may take a long time";
  }

  const [agentInput, setAgentInput] = useState("");
  const handleAgentInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setAgentInput(e.target.value);
  };

  const handleAgentSubmit = async (
    e: React.FormEvent,
    extraData: Record<string, unknown> = {}
  ) => {
    e.preventDefault();
    if (!agentInput.trim()) return;

    const message = agentInput;
    setAgentInput("");

    // Send message to agent
    await sendMessage(
      {
        role: "user",
        parts: [{ type: "text", text: message }]
      },
      {
        body: extraData
      }
    );
  };

  const {
    messages: agentMessages,
    clearHistory,
    status,
    sendMessage,
    stop
  } = useAgentChat<unknown, UIMessage<{ createdAt: string }>>({
    agent
  });

  const resetProfile = () => {
    clearHistory();
    agent.setState({ state: "introduction" });
  }

  // Scroll to bottom when messages change
  useEffect(() => {
    agentMessages.length > 0 && scrollToBottom();
  }, [agentMessages, scrollToBottom]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="h-screen w-full p-4 flex justify-center items-center bg-fixed overflow-hidden">
      <div className="h-[calc(100vh-2rem)] w-full mx-auto max-w-lg flex flex-col shadow-xl rounded-md overflow-hidden relative border border-neutral-300 dark:border-neutral-800">
        <div className="px-4 py-3 border-b border-neutral-300 dark:border-neutral-800 flex items-center gap-3 sticky top-0 z-10">
          <div className="flex-1">
            <h2 className="font-semibold text-base">Meetup app</h2>
          </div>

          <Button
            variant="ghost"
            size="md"
            shape="square"
            className="rounded-full h-9 w-9"
            onClick={toggleTheme}
          >
            {theme === "dark" ? <SunIcon size={20} /> : <MoonIcon size={20} />}
          </Button>

          <Button
            variant="ghost"
            size="md"
            shape="square"
            className="rounded-full h-9 w-9"
            onClick={resetProfile}
          >
            <TrashIcon size={20} />
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24 max-h-[calc(100vh-10rem)]">
          {agentMessages.length === 0 && (
            <div className="h-full flex items-center justify-center">
              <Card className="p-6 max-w-md mx-auto bg-neutral-100 dark:bg-neutral-900">
                <div className="text-center space-y-4">
                  <div className="bg-[#F48120]/10 text-[#F48120] rounded-full p-3 inline-flex">
                    <RobotIcon size={24} />
                  </div>
                  <h3 className="font-semibold text-lg">Welcome to meetup.ai</h3>
                  <p className="text-muted-foreground text-sm">
                    Meet new friends here ! Start by introducing yourself to this community. What is your name ?
                  </p>
                </div>
              </Card>
            </div>
          )}

          {agentMessages.map((m, index) => {
            const isMe = !(m as any).sentFromServer && m.role === "user";

            return (
              <div key={m.id}>
                <div
                  className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`flex gap-2 max-w-[85%] ${
                      isMe ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    {!isMe ? (
                      <Avatar username={"AI"} className="shrink-0" shortName={"AI"} />
                    ) : (
                      !isMe && <div className="w-8" />
                    )}

                    <div>
                      <div>
                        {m.parts?.map((part, i) => {
                          if (part.type === "text") {
                            return (
                              // biome-ignore lint/suspicious/noArrayIndexKey: immutable index
                              <div key={i}>
                                <Card
                                  className={`p-3 rounded-md bg-neutral-100 dark:bg-neutral-900 ${
                                    isMe
                                      ? "rounded-br-none"
                                      : "rounded-bl-none border-assistant-border"
                                  } ${
                                    part.text.startsWith("scheduled message")
                                      ? "border-accent/50"
                                      : ""
                                  } relative`}
                                >
                                  {part.text.startsWith(
                                    "scheduled message"
                                  ) && (
                                    <span className="absolute -top-3 -left-2 text-base">
                                      🕒
                                    </span>
                                  )}
                                  <MemoizedMarkdown
                                    id={`${m.id}-${i}`}
                                    content={part.text.replace(
                                      /^scheduled message: /,
                                      ""
                                    )}
                                  />
                                </Card>
                                <p
                                  className={`text-xs text-muted-foreground mt-1 ${
                                    isMe ? "text-right" : "text-left"
                                  }`}
                                >
                                  {formatTime(
                                    m.metadata?.createdAt
                                      ? new Date(m.metadata.createdAt)
                                      : new Date()
                                  )}
                                </p>
                              </div>
                            );
                          }

                          return null;
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAgentSubmit(e, {
              annotations: {
                hello: "world"
              }
            });
            setTextareaHeight("auto"); // Reset height after submission
          }}
          className="px-3 pb-3 bg-neutral-50 absolute bottom-0 left-0 right-0 z-10 border-t border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900"
        >
          {/* Typing Indicator */}
          {indicator && (
            <div className="px-1 py-2 mb-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-neutral-400 rounded-full animate-pulse"></div>
                  <div className="w-2 h-2 bg-neutral-400 rounded-full animate-pulse delay-500"></div>
                  <div className="w-2 h-2 bg-neutral-400 rounded-full animate-pulse delay-1000"></div>
                </div>
                <span>{indicator}</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Textarea
                disabled={isWaitingForPartner}
                placeholder={
                  isWaitingForPartner
                    ? "Waiting for community member..."
                    : "Send a message..."
                }
                className="flex w-full border border-neutral-200 dark:border-neutral-700 px-3 py-2  ring-offset-background placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:focus-visible:ring-neutral-700 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm min-h-[24px] max-h-[calc(75dvh)] overflow-hidden resize-none rounded-2xl text-base! pb-10 dark:bg-neutral-900"
                value={agentInput}
                onChange={(e) => {
                  handleAgentInputChange(e);
                  // Auto-resize the textarea
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                  setTextareaHeight(`${e.target.scrollHeight}px`);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    handleAgentSubmit(e as unknown as React.FormEvent);
                    setTextareaHeight("auto"); // Reset height on Enter submission
                  }
                }}
                rows={2}
                style={{ height: textareaHeight }}
              />
              <div className="absolute bottom-0 right-0 p-2 w-fit flex flex-row justify-end">
                {status === "submitted" || status === "streaming" ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 rounded-full p-1.5 h-fit border border-neutral-200 dark:border-neutral-800"
                    aria-label="Stop generation"
                  >
                    <StopIcon size={16} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 rounded-full p-1.5 h-fit border border-neutral-200 dark:border-neutral-800"
                    disabled={!agentInput.trim() || isWaitingForPartner}
                    aria-label="Send message"
                  >
                    <PaperPlaneTiltIcon size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

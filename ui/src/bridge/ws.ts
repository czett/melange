import { createSignal } from "solid-js";
import type {
  ClientCommand,
  EpgEntry,
  MelangeState,
  NavEvent,
  ServerMessage
} from "./types";

const EMPTY_STATE: MelangeState = {
  mode: "Home",
  overlay: "None",
  active_profile: null,
  profiles: [],
  channels: [],
  epg_now_next: {},
  playback: {
    state: "Idle",
    title: null,
    subtitle: null,
    channel_id: null,
    channel_number: null,
    current_media: null,
    position_sec: 0,
    duration_sec: 0,
    paused: false,
    is_zapping: false
  },
  digit_buffer: "",
  continue_watching: []
};

const [melangeState, setMelangeState] = createSignal<MelangeState>(EMPTY_STATE);
const [wsConnected, setWsConnected] = createSignal(false);
const [epgEntries, setEpgEntries] = createSignal<EpgEntry[]>([]);

type NavListener = (ev: NavEvent) => void;
const navListeners = new Set<NavListener>();

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;

function wsUrl(): string {
  const host = window.location.host || "127.0.0.1:9000";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${host}/ws`;
}

async function fetchFullEpg(): Promise<void> {
  try {
    const res = await fetch("/api/epg");
    if (res.ok) {
      const data = (await res.json()) as EpgEntry[];
      setEpgEntries(data);
    }
  } catch {
    // Ignore transient fetch errors during startup.
  }
}

export function onNavEvent(listener: NavListener): () => void {
  navListeners.add(listener);
  return () => navListeners.delete(listener);
}

export function emitLocalNavEvent(ev: NavEvent): void {
  for (const listener of navListeners) {
    listener(ev);
  }
}

export function sendCommand(cmd: ClientCommand): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(cmd));
  }
}

export function connectBridge(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const ws = new WebSocket(wsUrl());
  socket = ws;

  ws.onopen = () => {
    setWsConnected(true);
    void fetchFullEpg();
  };

  ws.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data as string) as ServerMessage;
      if (parsed.type === "StateSnapshot" || parsed.type === "StateUpdate") {
        setMelangeState(parsed.state);
      } else if (parsed.type === "NavEvent") {
        emitLocalNavEvent(parsed.event);
      }
    } catch {
      // Ignore malformed messages.
    }
  };

  ws.onclose = () => {
    setWsConnected(false);
    socket = null;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
    }
    reconnectTimer = window.setTimeout(() => {
      connectBridge();
    }, 800);
  };

  ws.onerror = () => {
    ws.close();
  };
}

export { melangeState, wsConnected, epgEntries };

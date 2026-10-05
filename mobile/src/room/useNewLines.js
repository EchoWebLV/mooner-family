// Calls `onLine(row)` for each chat line that arrives on `channel` while the screen is up
// (room.js newLines): never for the lines already there when it opened.
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { store } from "../app";
import { newLines } from "./room";

const EMPTY = [];

export function useNewLines(channel, onLine) {
  const rows = useStore(store, (s) => s.chats[channel]) ?? EMPTY;
  const last = useRef(null);
  const cb = useRef(onLine);
  useEffect(() => {
    cb.current = onLine;
  });
  useEffect(() => {
    const r = newLines(rows, last.current);
    last.current = r.lastId;
    r.lines.forEach((row) => cb.current(row));
  }, [rows]);
}

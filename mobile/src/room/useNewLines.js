// Calls `onLine(row)` for each chat line that arrives on `channel` while the screen is up
// (room.js newLinesOn): never for the lines already there when it opened, nor for a channel's
// lines when the channel changes (chat ids count across every channel).
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { store } from "../app";
import { newLinesOn } from "./room";

const EMPTY = [];

export function useNewLines(channel, onLine) {
  const rows = useStore(store, (s) => s.chats[channel]) ?? EMPTY;
  const last = useRef(null); // { channel, lastId } of the last read
  const cb = useRef(onLine);
  useEffect(() => {
    cb.current = onLine;
  });
  useEffect(() => {
    const r = newLinesOn(rows, channel, last.current);
    last.current = r.last;
    r.lines.forEach((row) => cb.current(row));
  }, [rows, channel]);
}

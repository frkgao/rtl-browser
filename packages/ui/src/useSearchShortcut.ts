// Copyright 2026 Frank Gao. SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";

/** One search shortcut for every pane, including dynamically mounted panels. */
export function useSearchShortcut() {
  useEffect(() => {
    let active: Element | null = null;
    const remember = (event: Event) => {
      const target = event.target;
      if (target instanceof Element) active = target.closest("[data-search-scope]") ?? active;
    };
    const visible = (el: HTMLElement) => el.getClientRects().length > 0;
    const search = (scope: Element | null) => scope
      ? [...scope.querySelectorAll<HTMLInputElement>("input[data-search-input]:not(:disabled)")].find(visible)
      : undefined;
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "f") return;
      const modal = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(visible).at(-1);
      const input = modal ? search(modal) : search(active?.isConnected ? active : null)
        ?? search(document.querySelector(".source-pane")) ?? search(document.body);
      if (!input) return;
      event.preventDefault();
      input.focus(); input.select();
    };
    document.addEventListener("pointerdown", remember, true);
    document.addEventListener("focusin", remember, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", remember, true);
      document.removeEventListener("focusin", remember, true);
      document.removeEventListener("keydown", key);
    };
  }, []);
}

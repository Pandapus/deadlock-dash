import { useEffect, useState } from "react";
import { getItems } from "../api/client";
import type { Item } from "../api/types";

export type ItemMap = Map<number, Item>;

export function useItems(): ItemMap {
  const [items, setItems] = useState<ItemMap>(new Map());
  useEffect(() => {
    getItems()
      .then(setItems)
      .catch((e) => console.error("Failed to load items", e));
  }, []);
  return items;
}

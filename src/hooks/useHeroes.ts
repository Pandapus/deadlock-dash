import { useEffect, useState } from "react";
import { getHeroes } from "../api/client";
import type { Hero } from "../api/types";

export type HeroMap = Map<number, Hero>;

export function useHeroes(): HeroMap {
  const [heroes, setHeroes] = useState<HeroMap>(new Map());
  useEffect(() => {
    getHeroes()
      .then((list) => setHeroes(new Map(list.map((h) => [h.id, h]))))
      .catch((e) => console.error("Failed to load heroes", e));
  }, []);
  return heroes;
}

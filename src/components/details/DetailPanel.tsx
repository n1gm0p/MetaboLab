"use client";

import { ChevronLeft, ChevronRight, Repeat, X } from "lucide-react";
import { useApp } from "@/components/state/app-state";
import { IconButton } from "@/components/ui/primitives";
import { MetaboliteCard } from "./MetaboliteCard";
import { ReactionCard } from "./ReactionCard";
import { EnzymeCard } from "./EnzymeCard";
import { PathwayCard } from "./PathwayCard";
import { NoteEditor } from "@/components/library/NoteEditor";
import { useNavigator } from "@/components/state/use-navigator";

export function DetailPanel() {
  const { state, dispatch } = useApp();
  const nav = useNavigator();
  const f = state.focus;
  const review = state.review;
  const goReview = (i: number) => {
    const ref = review?.items[i];
    if (!review || !ref) return;
    dispatch({ type: "setReview", review: { ...review, i } });
    nav.open(ref);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      {review && (
        <div className="flex shrink-0 items-center gap-1 border-b border-line bg-accent-soft px-3 py-1.5 text-[12px] text-accent">
          <Repeat className="h-3.5 w-3.5" />
          <span className="tabular flex-1 font-medium">
            Повторение {review.i + 1} / {review.items.length}
          </span>
          <IconButton label="Предыдущая карточка" size="sm" disabled={review.i === 0} onClick={() => goReview(review.i - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <IconButton label="Следующая карточка" size="sm" disabled={review.i >= review.items.length - 1} onClick={() => goReview(review.i + 1)}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
          <IconButton label="Закончить повторение" size="sm" onClick={() => dispatch({ type: "setReview", review: null })}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      )}
      <div className="flex h-12 shrink-0 items-center gap-1 px-2">
        <IconButton label="Назад" disabled={state.back.length === 0} onClick={() => dispatch({ type: "back" })}>
          <ChevronLeft className="h-[18px] w-[18px]" />
        </IconButton>
        <div className="flex-1" />
        <IconButton label="Закрыть карточку" onClick={() => dispatch({ type: "setRightOpen", value: false })}>
          <X className="h-[18px] w-[18px]" />
        </IconButton>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {f?.type === "metabolite" && <MetaboliteCard key={f.id} id={f.id} />}
        {f?.type === "reaction" && <ReactionCard key={f.id} id={f.id} />}
        {f?.type === "enzyme" && <EnzymeCard key={f.id} id={f.id} />}
        {f?.type === "pathway" && <PathwayCard key={f.id} id={f.id} />}
        {f && <NoteEditor key={`${f.type}:${f.id}`} refTo={f} title={nav.nameOf(f)} />}
      </div>
    </div>
  );
}

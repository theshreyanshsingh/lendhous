"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Section } from "@/components/ui";
import { BROKER_COURSE, courseProgress } from "@/lib/broker-kit";
import type { Broker } from "@/lib/mockData";
import { useStore } from "@/lib/store";

/** LendHous's short course for brokers (rank 25): five lessons, each with one question to pass it. */
export function BrokerCourse({ firm }: { firm: Broker }) {
  const { dispatch } = useStore();
  const progress = courseProgress(firm);
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [wrong, setWrong] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(!progress.finished);
  const pass = async (lessonId: string) => {
    const ok = await dispatch({ t: "passBrokerLesson", brokerId: firm.id, lessonId, answer: picked[lessonId] ?? -1 });
    setWrong(ok ? null : lessonId);
    if (ok) setOpen(null);
  };
  return (
    <Section title="Working with LendHous: a short course" right={<Badge tone={progress.finished ? "green" : "slate"}>{progress.done} of {progress.total} done</Badge>}>
      <div className="space-y-3 text-sm" data-testid="broker-course">
        <p className="text-xs text-muted-foreground">{progress.finished ? "You've finished the course. It's here to look back on." : "About 15 minutes: how LendHous lends, what Florida loans need, your fee, and draws. Each lesson ends with one question."}</p>
        {progress.finished && !showAll ? <button type="button" className="btn-ghost h-9! px-3! text-xs!" onClick={() => setShowAll(true)}>Show the lessons</button> : (
          <ol className="divide-y divide-border rounded-[2px] border border-border">
            {BROKER_COURSE.map((lesson, index) => {
              const done = firm.training?.done.includes(lesson.id) ?? false;
              return (
                <li key={lesson.id} className="p-3" data-testid="broker-lesson">
                  <button type="button" className="flex w-full items-baseline justify-between gap-3 text-left" aria-expanded={open === lesson.id} onClick={() => setOpen(open === lesson.id ? null : lesson.id)}>
                    <span className="font-medium">{index + 1}. {lesson.title} <span className="text-xs font-normal text-muted-foreground">· {lesson.minutes} min</span></span>
                    <span className={`shrink-0 text-xs ${done ? "text-good" : "text-muted-foreground"}`} data-testid="broker-lesson-state">{done ? "Passed" : "Not yet"}</span>
                  </button>
                  {open === lesson.id && (
                    <div className="mt-2 space-y-3">
                      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{lesson.points.map((point) => <li key={point}>{point}</li>)}</ul>
                      {!done && (
                        <fieldset className="space-y-1" data-testid="broker-lesson-check">
                          <legend className="label">{lesson.check.question}</legend>
                          {lesson.check.options.map((option, at) => <label key={option} className="flex items-start gap-2 text-xs"><input type="radio" name={`lesson-${lesson.id}`} className="mt-0.5" data-testid={`lesson-${lesson.id}-${at}`} checked={picked[lesson.id] === at} onChange={() => setPicked({ ...picked, [lesson.id]: at })} />{option}</label>)}
                          {wrong === lesson.id && <p className="text-xs text-warn">Not quite. Read the lesson again and try once more.</p>}
                          <button type="button" className="btn-primary mt-1 h-9! px-3! text-xs!" data-testid={`lesson-${lesson.id}-answer`} disabled={picked[lesson.id] === undefined} onClick={() => void pass(lesson.id)}>Check my answer</button>
                        </fieldset>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Section>
  );
}

/** Where a broker prints today's program sheet with its own brand and referral link. */
export function ProgramSheetLink() {
  return (
    <div className="glass flex flex-wrap items-center justify-between gap-3 p-4" data-testid="program-sheet-link">
      <div className="min-w-0">
        <h2 className="text-base font-medium">Program sheet</h2>
        <p className="text-sm text-muted-foreground">Today&apos;s rates and leverage for every program, with your name, contact details and referral link on it. Print it or save it as a PDF to hand clients.</p>
      </div>
      <Link className="btn-ghost" href="/broker-sheet" data-testid="open-program-sheet">Open the program sheet</Link>
    </div>
  );
}

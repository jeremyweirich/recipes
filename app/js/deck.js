// Swipeable card stack. Right = add to this week, left = skip. Tap = open recipe.
export function attachSwipe(card, { onPick, onSkip, onOpen }) {
  let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false, moved = false, id = null;
  const threshold = () => Math.min(120, card.offsetWidth * 0.3);

  card.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true; moved = false; id = e.pointerId;
    startX = e.clientX; startY = e.clientY; dx = dy = 0;
    card.setPointerCapture(id);
    card.style.transition = "none";
  });

  card.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== id) return;
    dx = e.clientX - startX; dy = e.clientY - startY;
    if (Math.abs(dx) > 6) moved = true;
    card.style.transform = `translate(${dx}px, ${dy * 0.2}px) rotate(${dx / 18}deg)`;
    card.dataset.lean = dx > 30 ? "pick" : dx < -30 ? "skip" : "";
  });

  const end = (e) => {
    if (!dragging || e.pointerId !== id) return;
    dragging = false;
    card.style.transition = "";
    if (dx > threshold()) fling(card, 1, onPick);
    else if (dx < -threshold()) fling(card, -1, onSkip);
    else {
      card.style.transform = "";
      card.dataset.lean = "";
      if (!moved && e.type === "pointerup") onOpen();
    }
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);

  card.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") fling(card, 1, onPick);
    else if (e.key === "ArrowLeft") fling(card, -1, onSkip);
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
  });
}

export function fling(card, dir, done) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.dataset.lean = dir > 0 ? "pick" : "skip";
  if (reduce) { done(); return; }
  card.style.transition = "transform 260ms ease-in, opacity 260ms ease-in";
  card.style.transform = `translate(${dir * 130}%, -4%) rotate(${dir * 18}deg)`;
  card.style.opacity = "0";
  card.addEventListener("transitionend", () => done(), { once: true });
}

/**
 * Replace a `<select>` with a thumbnail carousel. The select stays in the DOM
 * (hidden) and keeps the value, so existing readers and `change` listeners work.
 * Options supply `data-thumb` (image URL) and optional `data-detail` (subtitle).
 */
export function setupChoiceCarousel(select: HTMLSelectElement, label: string): HTMLElement {
  const id = `${select.id}Carousel`;
  const root = document.createElement("div");
  root.className = "choice-carousel";
  root.id = id;
  root.innerHTML = `
    <div class="choice-carousel-header">
      <span class="choice-carousel-label" id="${id}Label">${label}</span>
      <span class="choice-carousel-count" aria-hidden="true"></span>
    </div>
    <div class="choice-carousel-viewport">
      <button class="choice-carousel-arrow" type="button" data-step="-1" aria-label="Previous ${label.toLowerCase()}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div class="choice-carousel-track" role="radiogroup" aria-labelledby="${id}Label"></div>
      <button class="choice-carousel-arrow" type="button" data-step="1" aria-label="Next ${label.toLowerCase()}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>`;
  const track = root.querySelector<HTMLElement>(".choice-carousel-track")!;
  const count = root.querySelector<HTMLElement>(".choice-carousel-count")!;
  const options = [...select.options].filter((option) => !option.disabled);
  const cards = options.map((option) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "choice-card";
    card.setAttribute("role", "radio");
    card.dataset.value = option.value;
    const image = document.createElement("img");
    image.src = option.dataset.thumb ?? "";
    image.alt = "";
    image.width = 640;
    image.height = 400;
    image.loading = "lazy";
    image.decoding = "async";
    const name = document.createElement("span");
    name.className = "choice-card-name";
    name.textContent = option.textContent;
    card.append(image, name);
    if (option.dataset.detail) {
      const detail = document.createElement("span");
      detail.className = "choice-card-detail";
      detail.textContent = option.dataset.detail;
      card.append(detail);
    }
    track.append(card);
    return card;
  });

  const selectedIndex = () => Math.max(0, options.findIndex((option) => option.value === select.value));
  const scrollToCard = (card: HTMLElement, smooth: boolean) => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo?.({
      left: card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2,
      behavior: smooth && !reduce ? "smooth" : "auto",
    });
  };
  const render = (smooth = false) => {
    const index = selectedIndex();
    cards.forEach((card, i) => {
      card.setAttribute("aria-checked", String(i === index));
      card.tabIndex = i === index ? 0 : -1;
    });
    count.textContent = `${index + 1} / ${cards.length}`;
    if (cards[index]) scrollToCard(cards[index], smooth);
  };
  const choose = (index: number, focus = false) => {
    const wrapped = (index + cards.length) % cards.length;
    if (options[wrapped].value !== select.value) {
      select.value = options[wrapped].value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    render(true);
    if (focus) cards[wrapped].focus({ preventScroll: true });
  };

  cards.forEach((card, i) => card.addEventListener("click", () => choose(i)));
  for (const arrow of root.querySelectorAll<HTMLButtonElement>(".choice-carousel-arrow")) {
    arrow.addEventListener("click", () => choose(selectedIndex() + Number(arrow.dataset.step)));
  }
  track.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const index = event.key === "Home" ? 0 : event.key === "End" ? cards.length - 1 : step === undefined ? null : selectedIndex() + step;
    if (index === null) return;
    event.preventDefault();
    choose(index, true);
  });
  select.addEventListener("change", () => render(true));

  const source = select.closest("label") ?? select;
  source.before(root);
  source.hidden = true;
  // Arrows and edge fades show only when some cards are out of view.
  const layout = () => {
    root.dataset.overflow = String(track.scrollWidth > track.clientWidth + 1);
    render();
  };
  render();
  requestAnimationFrame(layout);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(layout).observe(track);
  return root;
}

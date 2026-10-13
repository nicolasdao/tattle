// The pinned header bar: lights the tab of the section on screen (like a segment going on air in the app's rundown),
// moves the playhead along the bar's bottom edge, and shows the bar's compact Download once the hero's is off screen.
(function () {
  const bar = document.getElementById("bar");
  const tabs = document.getElementById("tabs");
  const fill = document.getElementById("bar-fill");
  const track = document.getElementById("bar-track");
  if (!bar || !tabs) return;
  const links = [...tabs.querySelectorAll('a[href^="#"]')]; // the section tabs; the Docs tab is another page
  const sections = links.map((a) => document.querySelector(a.getAttribute("href")));

  // ---------- the tab of the section on screen ----------
  let current = null;
  function setCurrent(i) {
    if (i === current) return;
    current = i;
    links.forEach((a, n) => {
      if (n === i) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    });
    // On a phone the tabs scroll sideways: bring the active one into view without moving the page.
    const a = links[i];
    if (a && tabs.scrollWidth > tabs.clientWidth) {
      tabs.scrollTo({ left: a.offsetLeft - (tabs.clientWidth - a.offsetWidth) / 2, behavior: "smooth" });
    }
  }
  // A section is "on air" while it crosses a line a third of the way down the screen.
  function pick() {
    const line = window.innerHeight / 3;
    let at = null;
    sections.forEach((sec, i) => { if (sec && sec.getBoundingClientRect().top <= line) at = i; });
    // Past the end of the last section (the sign-off and footer), keep the last tab lit.
    setCurrent(at);
  }

  // ---------- the playhead and the section ticks ----------
  // Every layout read happens before the first write, so the browser lays the page out once, not once per tick.
  function placeTicks() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const barH = bar.offsetHeight, scrollY = window.scrollY;
    const tops = sections.filter(Boolean).map((sec) => sec.getBoundingClientRect().top + scrollY - barH);
    track.querySelectorAll("b").forEach((b) => b.remove());
    if (max <= 0) return;
    track.append(...tops.map((top) => {
      const b = document.createElement("b");
      b.style.left = `${(Math.min(1, Math.max(0, top / max)) * 100).toFixed(2)}%`;
      return b;
    }));
  }
  function progress(max, y) {
    fill.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
  }

  // The bar's state from the scroll position: every read first, then only writes.
  function update() {
    const max = document.documentElement.scrollHeight - window.innerHeight, y = window.scrollY;
    pick();
    progress(max, y);
    bar.classList.toggle("scrolled", y > 8);
  }
  let queued = false;
  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => { placeTicks(); onScroll(); });
  // Sections grow as their demos fill in and fonts load: the observer re-places the ticks and the bar whenever the page
  // changes size. Its callbacks run after the browser's own layout, so its reads are free (none forced at startup).
  if ("ResizeObserver" in window) new ResizeObserver(() => { placeTicks(); update(); }).observe(document.body);
  else { placeTicks(); onScroll(); }

  // ---------- the bar's Download, once the hero's big one is off screen ----------
  const bigDownload = document.querySelector(".hero .dl");
  const barDownload = bar.querySelector(".bar-dl");
  if (bigDownload && barDownload && "IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => {
      const show = !e.isIntersecting && e.boundingClientRect.top < 0;
      bar.classList.toggle("show-dl", show);
      barDownload.tabIndex = show ? 0 : -1;
    }, { threshold: 0 }).observe(bigDownload);
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initReveal();
  loadMenu();
  loadNews();
});

function initNav() {
  const nav = document.getElementById('nav');
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  const overlay = document.getElementById('navOverlay');

  window.addEventListener('scroll', () => {
    nav.classList.toggle('nav--scrolled', window.scrollY > 60);
  }, { passive: true });

  function openMenu() {
    links.classList.add('nav__links--open');
    toggle.classList.add('nav__toggle--open');
    overlay.classList.add('nav__overlay--visible');
  }

  function closeMenu() {
    links.classList.remove('nav__links--open');
    toggle.classList.remove('nav__toggle--open');
    overlay.classList.remove('nav__overlay--visible');
  }

  toggle.addEventListener('click', () => {
    links.classList.contains('nav__links--open') ? closeMenu() : openMenu();
  });

  overlay.addEventListener('click', closeMenu);

  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', closeMenu);
  });
}

function initReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal--visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

async function loadMenu() {
  const container = document.getElementById('menuContent');
  try {
    const res = await fetch('/api/menu');
    const data = await res.json();

    if (!data.categories.length && !data.menuDuJour.length) {
      container.innerHTML = '<p class="menu__empty">La carte sera bientôt disponible.</p>';
      return;
    }

    let html = '';

    if (data.menuDuJour.length) {
      const mdj = data.menuDuJour[0];
      html += `
        <div class="menu__jour reveal">
          <h3>Menu du Jour</h3>
          <p class="menu__jour-desc">${escapeHtml(mdj.description)}</p>
          <p class="menu__jour-price">${formatPrice(mdj.price)}</p>
        </div>
      `;
    }

    data.categories.forEach(cat => {
      if (!cat.items.length) return;
      html += `
        <div class="menu__category reveal">
          <h3 class="menu__category-title">${escapeHtml(cat.name)}</h3>
          ${cat.items.map(item => `
            <div class="menu__item">
              <div class="menu__item-info">
                <div class="menu__item-name">${escapeHtml(item.name)}</div>
                ${item.description ? `<div class="menu__item-desc">${escapeHtml(item.description)}</div>` : ''}
              </div>
              <div class="menu__item-price">${formatPrice(item.price)}</div>
            </div>
          `).join('')}
        </div>
      `;
    });

    container.innerHTML = html;
    container.querySelectorAll('.reveal').forEach(el => {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal--visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });
      observer.observe(el);
    });
  } catch {
    container.innerHTML = '<p class="menu__empty">La carte sera bientôt disponible.</p>';
  }
}

async function loadNews() {
  const container = document.getElementById('newsContent');
  try {
    const res = await fetch('/api/news');
    const news = await res.json();

    if (!news.length) {
      container.innerHTML = '<p class="news__empty">Aucune actualité pour le moment.</p>';
      return;
    }

    container.innerHTML = news.map(n => `
      <div class="news__card ${n.image ? 'news__card--has-image' : ''} reveal">
        ${n.image ? `<img class="news__image" src="${escapeHtml(n.image)}" alt="${escapeHtml(n.title)}" loading="lazy">` : ''}
        <div class="news__body">
          ${n.label ? `<span class="news__label">${escapeHtml(n.label)}</span>` : ''}
          <h3>${escapeHtml(n.title)}</h3>
          <div class="news__content">${n.content}</div>
          <div class="news__date">${formatDate(n.date)}</div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.reveal').forEach(el => {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal--visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });
      observer.observe(el);
    });
  } catch {
    container.innerHTML = '<p class="news__empty">Aucune actualité pour le moment.</p>';
  }
}

function formatPrice(price) {
  return Number(price).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + '€';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

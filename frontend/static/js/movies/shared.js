import {movieApi} from './movie-api.js';
export const movies=await movieApi.list();
export const info=m=>`${m.year} · ${m.country} · ${m.genre} · ★ ${m.rating} · ${m.status}`;
export const card=m=>`<article class="film-card"><a href="/phim/${m.slug}/"><img src="${m.poster}" alt="Poster ${m.title}" loading="lazy" decoding="async"><h3>${m.title}</h3><p>${m.year} · ★ ${m.rating}</p></a></article>`;

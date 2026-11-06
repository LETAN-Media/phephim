import {movieApi} from './movie-api.js';
export const movies=await movieApi.list();
export const info=m=>[m.year,m.country,m.genre,m.rating!=null?`★ ${m.rating}`:null,m.status].filter(Boolean).join(' · ');
export const card=m=>`<article class="film-card"><a href="/phim/${m.slug}/"><img src="${m.poster}" alt="Poster ${m.title}" loading="lazy" decoding="async"><h3>${m.title}</h3><p>${[m.year,m.rating!=null?`★ ${m.rating}`:null].filter(Boolean).join(' · ')||m.status}</p></a></article>`;

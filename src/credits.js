export const CREDITS = Object.freeze({
  name: 'Gabriel Fernandes',
  email: 'gabriel@cd2.com.br',
  github: 'https://github.com/nayamonia',
  site: 'https://cd2.com.br',
  license: 'MIT',
  year: 2026,
});

const host = (url) => new URL(url).host;

export function creditLine() {
  return `${CREDITS.license} License · Created by ${CREDITS.name} <${CREDITS.email}> · ${CREDITS.github} · ${CREDITS.site}`;
}

export function launchBanner({ version, providerName, profileId }) {
  return `wrapper-code ${version} · ${providerName}${profileId ? ` (${profileId})` : ''} · ${CREDITS.license} · by ${CREDITS.name} · ${host(CREDITS.site)}`;
}

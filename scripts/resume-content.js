import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';

export const careerPath = new URL('../career/index.html', import.meta.url);

// Optional drafts use the current career copy; the published PDF is supplied separately.
export async function readResumeContent() {
  const $ = load(await readFile(careerPath, 'utf8'));
  const text = (element) =>
    element.clone().find('br').replaceWith(' ').end().text().replace(/\s+/g, ' ').trim();
  const extra = load($('#resume-context').html() || '');
  const details = (element) =>
    extra(`[data-resume-key="${element.attr('data-resume-key')}"] p`)
      .toArray()
      .map((p) => text(extra(p)));
  const list = (elements) => elements.toArray().map((element) => text($(element)));
  return {
    name: text($('.print-name')),
    location: text($('.profile-location')),
    email: $('.career-contact .contact-email').attr('href').replace('mailto:', ''),
    github: $('.career-contact-actions a[href^="https://github.com/"]').attr('href'),
    summary: text($('.career-summary')),
    experience: $('.experience-item')
      .toArray()
      .map((element) => {
        const role = $(element);
        return {
          title: text(role.find('h3')),
          meta: list(role.find('.experience-meta span')).join(' | '),
          company: text(role.find('.experience-company')),
          summary: text(role.children('p').not('.experience-company')),
          bullets: [...list(role.find('li')), ...details(role)],
        };
      }),
    skills: $('.capability-grid article')
      .toArray()
      .map((element) => {
        const skill = $(element);
        return {
          title: text(skill.find('h3')),
          summary: text(skill.find('p')),
          tags: list(skill.find('.skill-tags span')).join(' · '),
          bullets: list(skill.find('li')),
        };
      }),
    projects: $('#selected-work .career-projects article')
      .toArray()
      .map((element) => {
        const project = $(element);
        return {
          title: text(project.find('h3')),
          category: text(project.find('.mini-label')),
          summary: text(project.find('p')),
          details: details(project),
          links: project
            .find('a')
            .toArray()
            .map((link) => ({
              label: text($(link)).replace(/\s*↗$/, ''),
              url: $(link).attr('href'),
            })),
        };
      }),
    education: $('#education article')
      .toArray()
      .map((element) => {
        const entry = $(element);
        return {
          institution: text(entry.find('h3')),
          dates: text(entry.find('.mini-label')),
          qualification: text(entry.find('p')),
        };
      }),
    references: text($('.career-contact-actions > span')),
  };
}

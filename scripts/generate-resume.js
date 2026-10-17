import PDFDocument from 'pdfkit';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readResumeContent } from './resume-content.js';

export async function generateResume() {
  const content = await readResumeContent();
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 42, left: 46, right: 46, bottom: 28 },
    bufferPages: true,
    info: {
      Title: `${content.name} — Resume`,
      Author: content.name,
      Subject: 'Experience, skills, AI proficiency, and projects',
      Creator: 'Jon Williams personal site',
    },
  });
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const left = 46;
  const width = 520;
  const bottom = 735;
  let y = 46;
  const font = (size, bold = false, color = '#263244') =>
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(size)
      .fillColor(color);
  const space = (height) => {
    if (y + height > bottom) {
      doc.addPage();
      y = 46;
    }
  };
  const paragraph = (value, { size = 10, bold = false, color, indent = 0, gap = 4, link } = {}) => {
    if (!value) return;
    font(size, bold, color);
    const options = { width: width - indent, lineGap: 0.5, link };
    const height = doc.heightOfString(value, options);
    space(height + gap);
    doc.text(value, left + indent, y, options);
    y += height + gap;
  };
  const heading = (value) => {
    space(76);
    y += 7;
    paragraph(value, { size: 11, bold: true, color: '#1253a3', gap: 8 });
  };
  const bullets = (items) =>
    items.forEach((item) => paragraph(`•  ${item}`, { indent: 8, gap: 3 }));

  paragraph(content.name, { size: 25, bold: true, color: '#11233c', gap: 6 });
  paragraph(content.location, { size: 10 });
  paragraph(content.email, { size: 10, color: '#1253a3', link: `mailto:${content.email}` });
  paragraph(content.github.replace('https://', ''), {
    size: 10,
    color: '#1253a3',
    link: content.github,
    gap: 12,
  });
  paragraph(content.summary, { size: 11, gap: 7 });
  heading('Experience');
  for (const role of content.experience) {
    space(100);
    paragraph(role.title, { size: 12, bold: true });
    paragraph(role.meta, { size: 8.5, bold: true, color: '#526174' });
    paragraph(role.company, { size: 9.5 });
    paragraph(role.summary);
    bullets(role.bullets);
    y += 5;
  }
  doc.addPage();
  y = 46;
  heading('Skills');
  for (const skill of content.skills) {
    space(65);
    paragraph(skill.title, { size: 11, bold: true });
    paragraph(skill.summary);
    paragraph(skill.tags, { size: 9, color: '#526174', gap: 7 });
    bullets(skill.bullets);
  }
  heading('Some of My Work');
  for (const project of content.projects) {
    space(90);
    paragraph(project.title, { size: 11, bold: true });
    paragraph(project.category, { size: 8.5, color: '#526174' });
    paragraph(project.summary);
    project.details.forEach((detail) => paragraph(detail));
    for (const link of project.links)
      paragraph(`${link.label}: ${link.url}`, { size: 9, color: '#1253a3', link: link.url });
    y += 6;
  }
  paragraph(content.references, { size: 9, color: '#526174', gap: 0 });
  const { count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(i);
    font(8, false, '#526174');
    doc.text(`${content.name}  ·  ${i + 1} / ${count}`, left, 751, {
      width,
      align: 'right',
      lineBreak: false,
    });
  }
  doc.end();
  const pdf = await complete;
  await mkdir(new URL('../public/', import.meta.url), { recursive: true });
  await writeFile(new URL('../public/jon-williams-resume.pdf', import.meta.url), pdf);
  return { pages: count, bytes: pdf.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Generated resume:', await generateResume());
}

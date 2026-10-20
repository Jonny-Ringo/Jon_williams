// Edit project details here. Asset imports are bundled by Vite for any deployment path.
import eyePreview from '../imgs/the-eye-light.png';
import eyeDarkPreview from '../imgs/the-eye-dark.png';

export const projects = {
  auction: {
    category: 'WEB DEVELOPMENT / ARWEAVE & AO',
    title: 'AOction House',
    intro:
      'An auction platform on Arweave and AO, supporting listing, bidding, refunds, settlement, and asset transfers.',
    sections: [
      [
        'The Idea',
        'FunctionOverForm explored a collection where each NFT functions as a playable game. The broader AOction House project explored expanded auction capabilities within the Arweave ecosystem.',
      ],
      [
        'My Contribution',
        'Developed auction interfaces and flows using HTML, CSS, JavaScript, and Lua on AO. Related FunctionOverForm work explored playable digital collectibles.',
      ],
      [
        'Featured Assets',
        'The DumDumz shown on the project card are examples of collectibles sold on AOction House.',
      ],
    ],
    links: [
      ['AOction House on GitHub', 'https://github.com/Jonny-Ringo/AOction_House'],
      ['1of1 / FunctionOverForm source', 'https://github.com/Jonny-Ringo/1of1_AOction_House'],
    ],
  },
  metrics: {
    category: 'GRAPHQL / POWERSHELL / DATA VISUALIZATION',
    title: 'The Eye',
    intro:
      'Ecosystem analytics and monitoring for Arweave and AO: developer activity, transactions, infrastructure health, and node/network signals.',
    preview: {
      src: eyePreview,
      darkSrc: eyeDarkPreview,
      alt: 'The Eye dashboard showing Arweave and AO network statistics',
      caption: 'Dashboard snapshot · September 2026',
    },
    sections: [
      [
        'The Work',
        'Built and maintained dashboards that track ecosystem activity and infrastructure health, including a 3D node visualization.',
      ],
      [
        'My Contribution',
        'Data collection, GraphQL queries, operational reporting, and visualizations that help teams understand network activity and investigate issues.',
      ],
    ],
    links: [
      ['Visit The Eye', 'https://eye-of-ao.arweave.net/'],
      ['Talk about this work', 'mailto:jon.k.williams.711@gmail.com?subject=On-chain%20reporting'],
    ],
  },
  community: {
    category: 'LEADERSHIP / TECHNICAL CUSTOMER SUCCESS',
    title: 'Technical & Community Operations',
    intro:
      'Connecting founder relationships, technical support, and operational delivery across digital products and ecosystems.',
    sections: [
      [
        'The Context',
        'Staff Officer & Community Lead at Forward Research, and Founder & CEO of DA Operations (formerly DAO Academy). Selected ecosystem experience includes Sarcophagus, Polkadot, Decent DAO, Arweave, and AO.',
      ],
      [
        'My Contribution',
        'Work directly with founders and senior leadership on partnerships, grants, and technical support. Own service design, client relationships, onboarding, and escalation programs; investigate technical issues with engineering teams and build automation, knowledge workflows, and reporting that connect customer feedback to product priorities.',
      ],
    ],
    links: [['View my experience', './career/#experience']],
  },
};

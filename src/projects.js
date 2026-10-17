// Edit project details here. Asset imports are bundled by Vite for any deployment path.
import eyePreview from '../imgs/the-eye-light.png';
import eyeDarkPreview from '../imgs/the-eye-dark.png';

export const projects = {
  auction: {
    category: 'WEB DEVELOPMENT / ARWEAVE & AO',
    title: 'AOction House & FunctionOverForm',
    intro: 'On-chain auctions and playable digital collectibles on Arweave and AO.',
    sections: [
      [
        'The Idea',
        'FunctionOverForm explored a collection where each NFT functions as a playable game. The broader AOction House project explored expanded auction capabilities within the Arweave ecosystem.',
      ],
      [
        'My Contribution',
        'Responsive web interfaces, game functionality, and interactive features, using HTML, CSS, JavaScript, and Lua on AO.',
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
    intro: 'A dashboard for Arweave and AO network activity, transaction metrics, and reports.',
    preview: {
      src: eyePreview,
      darkSrc: eyeDarkPreview,
      alt: 'The Eye dashboard showing Arweave and AO network statistics',
      caption: 'Dashboard snapshot · September 2026',
    },
    sections: [
      [
        'The Work',
        'Collected on-chain metrics with GraphQL and compiled daily reports on activity and engagement.',
      ],
      [
        'My Contribution',
        'Data collection, reporting, and visualizations to help monitor trends and platform activity.',
      ],
    ],
    links: [
      ['Visit The Eye', 'https://eye-of-ao.arweave.net/'],
      ['Talk about this work', 'mailto:jon.k.williams.711@gmail.com?subject=On-chain%20reporting'],
    ],
  },
  community: {
    category: 'COMMUNITY OPERATIONS / AUTOMATION',
    title: 'Community Operations',
    intro: 'Moderation tools, resources, online and in-person events, and day-to-day coordination.',
    sections: [
      [
        'The Context',
        'Community operations and advisory roles spanning Forward Research (Arweave + AO), Sarcophagus, Polkadot, Decent DAO, and DAO Academy.',
      ],
      [
        'My Contribution',
        'Selected and configured bots for moderation and coordination, managed official project accounts on X (Twitter), LinkedIn, and other social platforms, organized events and AMAs, developed community websites and resource libraries, and helped coordinate proposals and treasury operations. Also traveled to industry events, helped set up booths, and spoke with attendees about the projects.',
      ],
    ],
    links: [['View my experience', './career/#experience']],
  },
};

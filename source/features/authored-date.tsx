import * as pageDetect from 'github-url-detection';

import features from '../feature-manager.js';
import api from '../github-helpers/api.js';
import observe from '../helpers/selector-observer.js';

function buildQuery(commits: string[]): string {
	return `
		repository() {
			${commits.map((commit: string) => `
				_${commit}: object(oid: "${commit}") {
				... on Commit {
						authoredDate
					}
				}
			`).join('\n')}
		}
	`;
}

const getAuthorDates = async (commits: (string | undefined)[]): Promise<(string | undefined)[]> => {
	const filteredCommits = commits.filter((commit): commit is string => !!commit && /^[0-9a-f]+$/i.test(commit));
	if (filteredCommits.length === 0) {
		console.log('warn: no commits found', commits);
		return Array.from({length: commits.length});
	}
	const {repository} = await api.v4(buildQuery(filteredCommits));

	return commits.map(c => c && repository[`_${c}`].authoredDate);
};
function getCommitHash(commit: HTMLElement): string {
	return commit.querySelector('a.markdown-title')!.pathname.split('/').pop()!;
}
async function init(): Promise<void> {
	let commitElements: NodeListOf<HTMLElement> | Array<HTMLElement> = [];
	let commitHashes: string[] = [];
	if (pageDetect.isCommit()) {
		commitElements = [document.querySelector('.commit-meta')!];
		commitHashes = [document.location.pathname.split('/').pop()!];
	} else if (!pageDetect.isBlame()) {
		commitElements = document.querySelectorAll([
			'.js-commits-list-item', // `isCommitList`
			'[data-test-selector="pr-timeline-commits-list"] .TimelineItem', // `isPRConversation`
		].join(','));
		commitHashes = Array.from({length: commitElements.length});
		for (const [index, commit] of commitElements.entries()) {
			commitHashes[index] = getCommitHash(commit);
		}
	}
	const authoredDates = await getAuthorDates(commitHashes);
	for (const [index, commit] of commitElements.entries()) {
		const container = commit.querySelector('.commit-author')?.parentElement;
		if (container) {
			const commitTime = container.querySelector('relative-time');
			const authorDate = authoredDates[index];
			if (authorDate && commitTime?.getAttribute('datetime') !== authorDate) {
				const relativeTime = document.createElement('relative-time');
				relativeTime.setAttribute('datetime', authorDate);
				const span = document.createElement('span');
				span.classList.add('color-fg-muted');
				span.append('(authored ', relativeTime, ')');
				if (commitTime) {
					commitTime.after(' ', span);
				} else {
					container.append(span);
				}
			}
		}
	}
};

function hovercardInit(signal: AbortSignal): void {
	observe('[data-hydro-view*="commit-hovercard-hover"]', updateHovercard, {signal});
	observe('.react-blame-for-range', updateBlameLine, {signal});
}

async function updateBlameLine(container: HTMLElement): Promise<void> {
	const commit = container.querySelector(
		'[data-hovercard-url*="/commit/"]',
	);
	if (!commit) {
		return;
	}
	const {hovercardUrl} = commit.dataset;
	const commitHash = hovercardUrl?.split('/')[4];
	if (!commitHash) {
		return;
	}
	const [authorDate] = await getAuthorDates([commitHash]);
	if (container) {
		const commitTime = container.querySelector('relative-time');
		if (authorDate && commitTime && commitTime.getAttribute('datetime') !== authorDate) {
			const relativeTime = document.createElement('relative-time');
			relativeTime.setAttribute('datetime', authorDate);
			relativeTime.setAttribute('class', commitTime.getAttribute('class')!);
			relativeTime.classList.add('color-fg-muted');
			relativeTime.style.fontSize = 'xx-small';
			commitTime.after(' ', relativeTime);
		}
	}
	// TODO: batch requests
}

async function updateHovercard(hovercardData: HTMLElement): Promise<void> {
	const container = hovercardData.parentElement;
	const commitAnchor = container?.querySelector('a[href*="/commit/"]');
	if (!commitAnchor) {
		return;
	}
	const authors = container?.querySelectorAll('.commit-author');
	if (!authors || authors.length !== 2) {
		return;
	}
	const commitHash = new URL(commitAnchor.href).pathname.split('/')[4];
	const [authorDate] = await getAuthorDates([commitHash]);
	if (!authorDate) {
		return;
	}
	const relativeTime = document.createElement('relative-time');
	relativeTime.setAttribute('datetime', authorDate);
	authors[0].after(' ', relativeTime); // TODO: update text node too
}

void features.add(import.meta.url, {
	include: [
		pageDetect.isBlame,
		pageDetect.isCompare,
		pageDetect.isCommit,
		pageDetect.isCommitList,
		pageDetect.isPRConversation,
	],
	exclude: [
		pageDetect.isPRCommit404,
	],
	awaitDomReady: true, // TODO: start fetching based on page url
	init,
}, {
	init: hovercardInit,
});

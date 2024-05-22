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
	`
}

const getAuthorDates = async (commits: (string | undefined)[]): Promise<(string | undefined)[]> => {
	const filteredCommits = commits.filter((commit): commit is string => !!commit && /^[0-9a-f]+$/i.test(commit))
	if (!filteredCommits.length) {
		console.log('warn: no commits found', commits)
		return new Array(commits.length);
	}
	const {repository} = await api.v4(buildQuery(filteredCommits));

	return commits.map((c) => c && repository[`_${c}`].authoredDate)
}
function getCommitHash(commit: HTMLElement): string | undefined {
	const anchor = commit.querySelector('a[href*="/commit/"]');
	if (!anchor || !pageDetect.isSingleCommit(anchor)) {
		return;
	}
	return anchor.pathname.split('/').pop()!;
}
async function init() {
	let commitElements: NodeListOf<HTMLElement> | Array<HTMLElement> = [];
	let commitHashes: Array<string | undefined> = [];
	if (pageDetect.isCommit()) {
		commitElements = [document.querySelector('.commit-meta')!]
		commitHashes = [document.location.pathname.split('/').pop()!];
	} else if (!pageDetect.isBlame()) {
		commitElements = document.querySelectorAll([
			'.js-commits-list-item', // `isPRCommitList`
			'[data-testid="commit-row-item"]', // `isRepoCommitList`
			'[data-test-selector="pr-timeline-commits-list"] .TimelineItem', // `isPRConversation`
		].join(','));
		commitHashes = new Array(commitElements.length);
		commitElements.forEach((commit, i) =>{
			commitHashes[i] = getCommitHash(commit)
		})
	}
	const authoredDates = await getAuthorDates(commitHashes);
	commitElements.forEach((commit, i) => {
		const container =
			commit.querySelector('[data-testid="listview-item-main-content"]') ||
			commit.querySelector('.commit-author')?.parentElement;
		if (container) {
			const commitTime = container.querySelector('relative-time');
			const authorDate = authoredDates[i];
			if (authorDate && commitTime?.getAttribute('datetime') !== authorDate) {
				const relTime = document.createElement('relative-time');
				relTime.setAttribute('datetime', authorDate);
				const span = document.createElement('span');
				span.classList.add('color-fg-muted', 'pl-1');
				span.append('(authored ', relTime, ')');
				if (commitTime) {
					commitTime.after(' ', span);
				} else {
					container.append(span);
				}
			}
		}
	})

	if (pageDetect.isBlame()) {

	}
};


function hovercardInit(signal: AbortSignal): void {
	observe('[data-hydro-view*="commit-hovercard-hover"]', updateHovercard, {signal});
	observe('.react-blame-for-range', updateBlameLine, {signal});
}

async function updateBlameLine(container: HTMLElement) {
	const commit = container.querySelector(
		'[data-hovercard-url*="/commit/"]'
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
			const relTime = document.createElement('relative-time');
			relTime.setAttribute('datetime', authorDate);
			relTime.setAttribute('class', commitTime.getAttribute('class')!)
			relTime.classList.add('color-fg-muted');
			relTime.style.fontSize = 'xx-small';
			commitTime.after(' ', relTime);
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
	const relTime = document.createElement('relative-time');
				relTime.setAttribute('datetime', authorDate);
	authors[0].after(' ', relTime); // TODO: update text node too
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
	init: hovercardInit
});

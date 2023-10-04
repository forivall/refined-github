import * as pageDetect from 'github-url-detection';
import features from '../feature-manager.js';
import api from '../github-helpers/api.js';

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

const getAuthorDates = async (commits: string[]): Promise<(string | undefined)[]> => {
	const filteredCommits = commits.filter((commit) => /^[0-9a-f]+$/i.test(commit))
	if (!filteredCommits.length) {
		console.log('warn: no commits found', commits)
		return new Array(commits.length);
	}
	const {repository} = await api.v4(buildQuery(filteredCommits));

	return commits.map((c) => repository[`_${c}`].authoredDate)
}
function getCommitHash(commit: HTMLElement): string {
	return commit.querySelector('a.markdown-title')!.pathname.split('/').pop()!;
}
async function init() {
	let commitElements: NodeListOf<HTMLElement> | Array<HTMLElement>;
	let commitHashes: string[];
	if (pageDetect.isCommit()) {
		commitElements = [document.querySelector('.commit-meta')!]
		commitHashes = [document.location.pathname.split('/').pop()!];
	} else {
		commitElements = document.querySelectorAll([
			'.js-commits-list-item', // `isCommitList`
			'[data-test-selector="pr-timeline-commits-list"] .TimelineItem', // `isPRConversation`
		].join(','));
		commitHashes = new Array<string>(commitElements.length);
		commitElements.forEach((commit, i) =>{
			commitHashes[i] = getCommitHash(commit)
		})
	}
	const authoredDates = await getAuthorDates(commitHashes);
	commitElements.forEach((commit, i) => {
		const container = commit.querySelector('.commit-author')?.parentElement;
		if (container) {
			const commitTime = container.querySelector('relative-time');
			const authorDate = authoredDates[i];
			if (authorDate && commitTime?.getAttribute('datetime') !== authorDate) {
				const relTime = document.createElement('relative-time');
				relTime.setAttribute('datetime', authorDate);
				const span = document.createElement('span');
				span.classList.add('color-fg-muted');
				span.append('(authored ', relTime, ')');
				if (commitTime) {
					commitTime.after(' ', span);
				} else {
					container.append(span);
				}
			}
		}
	})
};

void features.add(import.meta.url, {
	include: [
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
});

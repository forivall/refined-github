import './keyboard-navigation.css';
import {$, $$, elementExists} from 'select-dom';
import * as pageDetect from 'github-url-detection';

import features from '../feature-manager.js';
import {isEditable} from '../helpers/dom-utils.js';

const isCommentGroupMinimized = (comment: HTMLElement): boolean =>
	elementExists('.minimized-comment:not(.d-none)', comment)
	|| Boolean(comment.closest([
		'.js-resolvable-thread-contents.d-none', // Regular comments
		'details.js-resolvable-timeline-thread-container:not([open])', // Review comments on Conversation tab
	]) ||
		isDisplayNone(comment.closest('.js-file-content')) // Review comments on Files tab
	);

const isDisplayNone = (element: Element | null | undefined) => element && getComputedStyle(element).display === 'none'

const isFileMinimized = (element: HTMLElement | null): boolean =>
	Boolean(element?.classList.contains('js-file') && isDisplayNone($('.js-file-content', element)))

let lastViewChange: HTMLElement | null | undefined;
function trackLastViewChange(event: Event): void {
	const element = (event.target as EventTarget & Partial<Pick<Element, 'closest'>>).closest?.('.js-targetable-element[id^="diff-"]');
	if (element) {
		lastViewChange = element;
	}
}

function runShortcuts(event: KeyboardEvent): void {
	if ((event.key !== 'j' && event.key !== 'k' && event.key !== 'x') || isEditable(event.target)) {
		return;
	}

	event.preventDefault();

	const focusedComment = ($(window.location.hash ? window.location.hash : ':target') || lastViewChange)!;

	if (event.key === 'x') {
		if (!focusedComment) {
			return;
		}
		const toggle = $('.js-reviewed-toggle', focusedComment)
		if (toggle) {
			const wasFileMinimized = isFileMinimized(focusedComment);
			toggle.click();
			if (wasFileMinimized) {
				location.replace('#' + focusedComment.id);
			}
		}
		return;
	}

	const items
		= $$([
			'.js-targetable-element[id^="diff-"]', // Files in diffs
			'.js-minimizable-comment-group', // Comments (to be `.filter()`ed)
		])
			.filter(element =>
				element.classList.contains('js-minimizable-comment-group')
					? !isCommentGroupMinimized(element)
					: true,
			);

	// `j` goes to the next comment, `k` goes back a comment
	const direction = event.key === 'j' ? 1 : -1;
	let currentIndex = items.indexOf(focusedComment);
	if (currentIndex < 0) {
		const closestComment = focusedComment?.querySelector('.js-minimizable-comment-group');
		if (closestComment) {
			currentIndex = items.indexOf(closestComment);
		}
	}

	// Start at 0 if nothing is; clamp index
	const chosenCommentIndex = Math.min(
		Math.max(0, currentIndex + direction),
		items.length - 1,
	);

	if (currentIndex !== chosenCommentIndex) {
		const chosenComment = items[chosenCommentIndex];
		for (const item of items) {
			if (item.classList.contains('details-collapsed-target')) {
				item.classList.remove('details-collapsed-target');
			}
			if (item.classList.contains('not-target')) {
				item.classList.remove('not-target');
			}
		}
		if (chosenComment.classList.contains('js-details-container') && isFileMinimized(chosenComment)) {
			// Change hash without focusing and expanding
			window.history.replaceState(window.history.state, '', '#' + chosenComment.id);
			chosenComment.scrollIntoView();
			chosenComment.classList.add('details-collapsed-target');
			$(':target')?.classList.add('not-target');
		} else {
			// Focus comment without pushing to history
			location.replace('#' + chosenComment.id);
		}
	}
}

function init(signal: AbortSignal): void {
	document.body.addEventListener('keypress', runShortcuts, {signal});
	document.body.addEventListener('change', trackLastViewChange);
	document.body.addEventListener('focus', trackLastViewChange);
}

void features.add(import.meta.url, {
	shortcuts: {
		j: 'Focus the comment/file below',
		k: 'Focus the comment/file above',
	},
	include: [
		pageDetect.hasComments,
	],
	init,
});

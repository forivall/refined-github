import './align-issue-labels.css';
import * as pageDetect from 'github-url-detection';

import features from '../feature-manager';

void features.addCssFeature(import.meta.url, [pageDetect.isIssueOrPRList]);

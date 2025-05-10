import {isValidContent} from "./valid-content-check";
import { Document } from '@langchain/core/documents';

type DocFactory = (rec: Record<string,string>, sourceName: string) => Document[];

export const fileConfigs: {
    path: string;
    factory: DocFactory;
}[] = [
    {
        path: 'src/datasets/20200325_counsel_chat.csv',
        factory: (rec, src) => {
            const title = rec.questionTitle?.trim() || '';
            const text  = rec.questionText?.trim()   || '';
            const combo = [title, text].filter(Boolean).join('\n\n');
            return combo && isValidContent(combo)
                ? [new Document({ pageContent: combo, metadata: { name: src } })]
                : [];
        }
    },
    {
        path: 'src/datasets/counselchat-data.csv',
        factory: (rec, src) => {
            const q = rec.questionText?.trim() || '';
            const a = (rec.answerText || '').replace(/<[^>]*>?/g,'').trim();
            const combo = [q, a].filter(Boolean).join('\n\n');
            return combo && isValidContent(combo)
                ? [new Document({ pageContent: combo, metadata: { name: src } })]
                : [];
        }
    },
    {
        path: 'src/datasets/psychology_dataset.csv',
        factory: (rec, src) => {
            const q  = rec.question?.trim()       || '';
            const rj = rec.response_j?.trim()     || '';
            const combo = [q,rj].filter(Boolean).join('\n\n');
            return combo && isValidContent(combo)
                ? [new Document({ pageContent: combo, metadata: { name: src } })]
                : [];
        }
    }
];
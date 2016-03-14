import INTERNAL_PROPS from '../../../processing/dom/internal-properties';
import SandboxBase from '../base';
import WindowSandbox from './window';
import DocumentSandbox from './document';
import ElementSandbox from './element';
import FocusBlurSandbox from '../event/focus-blur';
import domProcessor from '../../dom-processor';
import * as urlUtils from '../../utils/url';
import * as domUtils from '../../utils/dom';
import getNativeQuerySelectorAll from '../../utils/get-native-query-selector-all';

const ATTRIBUTE_SELECTOR_REG_EX = /\[([\w-]+)(\^?=.+?)]/g;

export default class NodeSandbox extends SandboxBase {
    constructor (nodeMutation, iframeSandbox, eventSandbox, uploadSandbox, shadowUI) {
        super();

        this.raiseBodyCreatedEvent               = this._onBodyCreated;
        document[INTERNAL_PROPS.documentCharset] = domUtils.parseDocumentCharset();

        this.eventSandbox  = eventSandbox;
        this.iframeSandbox = iframeSandbox;
        this.shadowUI      = shadowUI;
        this.mutation      = nodeMutation;

        this.doc     = new DocumentSandbox(this);
        this.win     = new WindowSandbox(this, eventSandbox.message);
        this.element = new ElementSandbox(this, uploadSandbox, iframeSandbox, shadowUI);
    }

    _onBodyCreated () {
        this.eventSandbox.listeners.initDocumentBodyListening(this.document);
        this.mutation.onBodyCreated({
            body: this.document.body
        });
    }

    _processElement (el) {
        if (el[INTERNAL_PROPS.processedContext] !== this.window) {
            el[INTERNAL_PROPS.processedContext] = this.window;

            if (!domUtils.isDocumentFragmentNode(el))
                domProcessor.processElement(el, urlUtils.convertToProxyUrl);

            this.element.processElement(el);
            this.eventSandbox.processElement(el);
        }
    }

    processNodes (el, doc) {
        if (!el) {
            doc = doc || this.document;

            if (doc.documentElement)
                this.processNodes(doc.documentElement);
        }
        else if (el.querySelectorAll) {
            this._processElement(el);

            var children = getNativeQuerySelectorAll(el).call(el, '*');

            for (var i = 0; i < children.length; i++)
                this._processElement(children[i]);
        }
    }

    // NOTE: DOM sandbox hides evidence of the content proxying from a page native script. Proxy replaces URLs for
    // resources. Our goal is to make the native script think that all resources are fetched from the destination
    // resource, not from proxy, and also provide proxying for dynamically created elements.
    attach (window) {
        var document = window.document;

        super.attach(window, document);

        this.iframeSandbox.on(this.iframeSandbox.IFRAME_DOCUMENT_CREATED_EVENT, e => {
            // NOTE: Before overriding the iframe, we must restore native document methods.
            // Therefore, we save them before they are overridden.
            var iframeNativeMethods = new this.nativeMethods.constructor(e.iframe.contentDocument, e.iframe.contentWindow);

            e.iframe.contentWindow[INTERNAL_PROPS.iframeNativeMethods] = iframeNativeMethods;

            // NOTE: Override only the document (in fact, we only need the 'write' and 'writeln' methods).
            this.doc.attach(e.iframe.contentWindow, e.iframe.contentDocument);
        });

        window[INTERNAL_PROPS.processDomMethodName] = (el, doc) => this.processNodes(el, doc);

        // NOTE: In some browsers (for example Firefox), the 'window.document' object is different when iframe is
        // created and when the document’s ready event is raised. Therefore, we need to update the 'document' object
        // to override its methods (Q527555).
        document.addEventListener('DOMContentLoaded', () => this.processNodes(null, document), false);

        this.doc.attach(window, document);
        this.win.attach(window);
        this.element.attach(window);
    }

    static _processAttributeSelector (selector) {
        if (!ATTRIBUTE_SELECTOR_REG_EX.test(selector))
            return selector;

        return selector.replace(ATTRIBUTE_SELECTOR_REG_EX, (str, name, operatorWithValue) => {
            if (domProcessor.URL_ATTRS.indexOf(name) !== -1) {
                name  = domProcessor.getStoredAttrName(name);

                return '[' + name + operatorWithValue + ']';
            }

            return str;
        });
    }

    static processSelector (selector) {
        if (selector) {
            selector = FocusBlurSandbox._processFocusPseudoClassSelector(selector);
            selector = NodeSandbox._processAttributeSelector(selector);
        }

        return selector;
    }
}

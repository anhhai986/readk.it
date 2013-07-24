/*
** controller.js
**
** Author: Jason Darwin
**
** Our main controller, bootstrapped by require.js.
*/

define([
    'jquery',
    'jquery.storage',
    'jquery.ba-urlinternal.min',
    'app/config',
    'app/epub',
    'app/layout',
    'app/chrome'
], function($, $storage, jbum, config, Epub, Layout, Chrome){

    var pages = [];
    var stylesheets = [];
    var load_publication_callback;
    var publication;
    var item;
    var queue = $({});
    var layout;
    var chrome;
    var self;

    // Classic pubsub, as per https://gist.github.com/addyosmani/1321768
    var subscribe = function() {
        queue.on.apply(queue, arguments);
    };
    var unsubscribe = function() {
        queue.off.apply(queue, arguments);
    };
    var publish = function() {
        queue.trigger.apply(queue, arguments);
    };

    /* Constructor */
     function Controller (book, callback) {
        self = this;

        load_publication_callback = callback;

        // Parse the EPUB
        publication = _initialise(book, load_publication);
        this.publication = publication;
        this.subscribe = subscribe;
        this.unsubscribe = unsubscribe;
        this.publish = publish;

        return this;
    }

    /* Define the instance methods */
    Controller.prototype = {
        initialise: function(book, files) {
            return _initialise(book, load_publication, files);
        },
        getPublication: function(){
            return (publication);
        },
        publication_finalise: function () {
        }
    };

    var _initialise = function (book, callback, files) {
        // Parse the EPUB
        return new Epub(book, 'META-INF/container.xml', callback, files);
    };

    var load_publication = function (epub) {
        // require.js text plugin fires asynchronously, so we'll use
        // deferreds to work out when all texts have been retrieved.
        // If your brain hurts thinking about deferreds, this example
        // may be useful: https://gist.github.com/sousk/874094
        $.when(load_html(epub), load_css(epub)).done(function(pages, stylesheets){
            // All deferreds have been resolved.
            // We can now load the retrieved pages into our
            // publication according to the order specified.
            layout_publication(epub, pages, stylesheets);
        });
    };

    function load_html(pub){
        // Because our calls to retreive the pages are async,
        // it's possible that we receive the pages back out of order.
        return $.Deferred(function(d){
            var pages = [];

            $.when.apply(this, $.map(pub.spine_entries, function(value) {
                return $.Deferred(function(deferred_page){

                    var filename = '';
                    if (value.href.indexOf('/') === 0) {
                        filename = value.href.substr(1, value.href.length);
                    }

                    if (filename && pub.content[filename]) {
                        // Our content's already been retrieved.
                        // Remove the <body> element to mimic the behaviour of requirejs/text.
                        var html = $($($.parseXML(pub.content[filename])).find('body').children()[0]).unwrap().html();
                        deferred_page.resolve(html);
                    } else {
                        // Use the requirejs/text plugin to load our html resources.
                        // https://github.com/requirejs/text
                        require(["text!" + value.href + "!strip"],
                            function(html) {
                                deferred_page.resolve(html);
                            }
                        );
                    }

                }).done(function(html){
                    // !strip removes the <body> element, however this may leave us
                    // without a root element, therefore we need to enclose the
                    // stripped html in a root <div>.
                    pages[value.id] = '<div>' + html + '</div>';
                });
            })).done(function(){
                d.resolve(pages);
            });

        });
    }

    function load_css(pub){
        return $.Deferred(function(d){
            var stylesheets = [];

            $.when.apply(this, $.map(pub.css_entries, function(value) {
                return $.Deferred(function(deferred_stylesheet){

                    var filename = '';
                    if (value.href.indexOf('/') === 0) {
                        filename = value.href.substr(1, value.href.length);
                    }

                    if (filename && pub.content[filename]) {
                        // Our content's already been retrieved.
                        var css = pub.content[filename];
                        deferred_stylesheet.resolve(css);
                    } else {
                        // Use the require-css plugin to load our stylesheet resources.
                        require(["css!" + value.href],
                            function(css) {
                                deferred_stylesheet.resolve(css);
                            }
                        );
                    }

                }).done(function(css){
                    stylesheets[value.id] = css;
                });
            })).done(function(){
                d.resolve(stylesheets);
            });

        });
    }

    function layout_publication(publication, pages, css) {
        // Create our layout for this publication.
        layout = new Layout(self, publication);

        var url_selectors = $.map($.elemUrlAttr(), function(i, v){
            return v + '[' + i + ']';
        }).join(',');

        $.each(publication.getToc(), function(index, value){

            // Ensure internal image urls have the correct path prepended.
            // We have to do this here as jQuery will try to resolve the src.
            pages[value.id] = pages[value.id].replace(/(<[^<>]* (?:src|poster)=['"])/g, '$1' + value.path.replace(/[^\/]+/g, '..') + value.href.replace(/[^\/]*?$/, ''));

            var page = $(pages[value.id]);
            // We have to rewrite any internal urls and corresponding ids
            var internal_urls = page.find(url_selectors).filter(':urlInternal');

            $.each(internal_urls, function(i, v){
                if ( typeof $(v).attr('href') !== 'undefined' ) {
                    if ( $(v).attr('rel') != 'external' ) {
                        if ($(v).attr('href').substr(0,1) == '#') {
                            // We must have something like '#milestone1'; convert to '#chapter1_milestone1'
                            $(v).attr('href', '#' + publication.file + '_' + $(v).attr('href').substr(1));
                        } else {
                            // We must have something like 'text/chapter2.xhtml#milestone1'; convert to '#text_chapter2.xhtml_milestone1'
                            $(v).attr('href', '#' + $(v).attr('href').replace(/\//g, '_').replace(/#/g, '_'));
                        }
                    }
                }
                return $(v);
            });

            $.each(page.find('[id]'), function(i, v){
                // We want to change something like 'milestone1' to 'chapter1_milestone1'
                $(v).attr('id', value.file + '_' + $(v).attr('id'));
                return $(v);
            });

            // OK, so now we need to get the outerHTML
            // http://stackoverflow.com/questions/2419749/get-selected-elements-outer-html
            var results = '';
            $.each(page.clone().wrap('<div>').parent(), function(i, v){
                results += $(v).html();
            });
            pages[value.id] = results;
            layout.add(value.id, value.file, pages[value.id]);
        });

        layout.update(layout.page_scrollers[0].scroller);
        layout.restore_bookmarks();

        // Create our chrome for this layout 
        // Note that our chrome won't actually be initialised
        // until our layout has been finalised.
        chrome = new Chrome(self, layout);

        layout.finalise();

        load_publication_callback(publication, layout);
    }

    return (Controller);
});
